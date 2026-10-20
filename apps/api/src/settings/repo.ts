import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  ALLOWED_IMAGE_TYPES,
  BRANDING_ASSET_KINDS,
  DEFAULT_APPEARANCE,
  appearanceSchema,
  generalSettingsSchema,
  smtpSettingsSchema,
  type Appearance,
  type BrandingAssetKind,
  type GeneralSettings,
  type Locale,
  type SmtpSettings,
} from '@easysend/shared';
import type { Clock } from '../clock.js';
import { nowSeconds } from '../clock.js';
import { decryptSecret, encryptSecret } from '../crypto/aead.js';
import type { DerivedKeys, KeyPurpose } from '../crypto/keys.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema/index.js';

/** Cloudflare tunnel created by the wizard / admin panel (no secrets: the token lives in the shared volume). */
export const tunnelSettingSchema = z.object({
  hostname: z.string().min(1),
  tunnelId: z.string().min(1),
  accountId: z.string().min(1),
  zoneId: z.string().min(1),
  /** Unix seconds. */
  configuredAt: z.number().int(),
});
export type TunnelSetting = z.infer<typeof tunnelSettingSchema>;

/**
 * First admin collected by the wizard, created only when the setup completes. The whole value is
 * encrypted at rest (it holds the password hash and the plain TOTP secret).
 */
export const setupAdminPendingSchema = z.object({
  email: z.string().min(1),
  displayName: z.string().nullable(),
  passwordHash: z.string().min(1),
  /** Plain base32 secret (the stored value is encrypted as a whole). */
  totpSecret: z.string().min(1),
  /** Unix seconds. */
  createdAt: z.number().int(),
});
export type SetupAdminPending = z.infer<typeof setupAdminPendingSchema>;

/** Stored metadata of an uploaded branding image; the file is `brandingDir/<fileName>`. */
export const brandingAssetEntrySchema = z.object({
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  /** Content hash, served as ETag. */
  etag: z.string().min(1),
  /** Unix seconds, used as `?v=` cache buster. */
  updatedAt: z.number().int(),
  fileName: z.string().min(1),
});
export type BrandingAssetEntry = z.infer<typeof brandingAssetEntrySchema>;

/**
 * `emailLogo` is not a public asset kind: it is the PNG rendition of the light logo embedded in
 * emails (always PNG, hence no content type).
 */
export const emailLogoEntrySchema = brandingAssetEntrySchema.omit({ contentType: true });
export type EmailLogoEntry = z.infer<typeof emailLogoEntrySchema>;

const brandingAssetsSettingSchema = z.object({
  ...(Object.fromEntries(
    BRANDING_ASSET_KINDS.map((kind) => [kind, brandingAssetEntrySchema.optional()]),
  ) as Record<BrandingAssetKind, z.ZodOptional<typeof brandingAssetEntrySchema>>),
  emailLogo: emailLogoEntrySchema.optional(),
});
/** Absent key = built-in default for that asset. */
export type BrandingAssetsSetting = z.infer<typeof brandingAssetsSettingSchema>;

/** Known setting keys with their value schema. Values are stored as JSON. */
const SETTING_SCHEMAS = {
  smtp: smtpSettingsSchema,
  general: generalSettingsSchema,
  appearance: appearanceSchema,
  setup_completed: z.boolean(),
  public_url: z.url(),
  tunnel: tunnelSettingSchema,
  setup_admin_pending: setupAdminPendingSchema,
  branding_assets: brandingAssetsSettingSchema,
} as const;

export interface SettingValues {
  smtp: SmtpSettings;
  general: GeneralSettings;
  appearance: Appearance;
  setup_completed: boolean;
  public_url: string;
  tunnel: TunnelSetting;
  setup_admin_pending: SetupAdminPending;
  branding_assets: BrandingAssetsSetting;
}
/** What `set` accepts: `general` may omit fields that have a default (e.g. `updateCheck`). */
export type SettingInputs = Omit<SettingValues, 'general'> & {
  general: z.input<typeof generalSettingsSchema>;
};
export type SettingKey = keyof SettingValues;

/** Keys whose whole JSON value is encrypted at rest (`is_encrypted = 1`), with the key purpose. */
export const ENCRYPTED_KEYS: Partial<Record<SettingKey, KeyPurpose>> = {
  smtp: 'smtp',
  setup_admin_pending: 'totp',
};

export const DEFAULT_LOCALE: Locale = 'it';
export const DEFAULT_INSTANCE_NAME = 'EasySend';

export interface SettingsRepo {
  /** Typed read. Undefined when missing or when the stored value no longer matches its schema. */
  get<K extends SettingKey>(key: K): SettingValues[K] | undefined;
  set<K extends SettingKey>(key: K, value: SettingInputs[K]): void;
  delete(key: SettingKey): void;
  /** Instance default language (`general.defaultLocale`), `it` when unset. */
  getDefaultLocale(): Locale;
  /** Instance name (`appearance.instanceName`), `EasySend` when unset. */
  getInstanceName(): string;
  /** Stored appearance, `DEFAULT_APPEARANCE` when unset. */
  getAppearance(): Appearance;
  /** True once the wizard has finished (`setup_completed === true`). */
  isSetupCompleted(): boolean;
}

export function createSettingsRepo(deps: {
  db: Db;
  keys: Pick<DerivedKeys, 'smtp' | 'totp'>;
  clock: Clock;
}): SettingsRepo {
  const { db, keys, clock } = deps;
  const keyFor = (purpose: KeyPurpose): Buffer => {
    if (purpose === 'smtp') return keys.smtp;
    if (purpose === 'totp') return keys.totp;
    throw new Error(`No key available for setting purpose ${purpose}`);
  };

  const repo: SettingsRepo = {
    get(key) {
      const row = db.select().from(settings).where(eq(settings.key, key)).get();
      if (!row) return undefined;
      let value: unknown = row.value;
      const purpose = ENCRYPTED_KEYS[key];
      if (row.isEncrypted) {
        if (!purpose || typeof value !== 'string') return undefined;
        try {
          value = JSON.parse(decryptSecret(keyFor(purpose), purpose, value));
        } catch {
          return undefined;
        }
      }
      const parsed = SETTING_SCHEMAS[key].safeParse(value);
      return parsed.success ? (parsed.data as SettingValues[typeof key]) : undefined;
    },

    set(key, value) {
      const purpose = ENCRYPTED_KEYS[key];
      const stored = purpose
        ? encryptSecret(keyFor(purpose), purpose, JSON.stringify(value))
        : value;
      const updatedAt = nowSeconds(clock);
      const isEncrypted = purpose !== undefined;
      db.insert(settings)
        .values({ key, value: stored, isEncrypted, updatedAt })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: stored, isEncrypted, updatedAt },
        })
        .run();
    },

    delete(key) {
      db.delete(settings).where(eq(settings.key, key)).run();
    },

    getDefaultLocale: () => repo.get('general')?.defaultLocale ?? DEFAULT_LOCALE,
    getAppearance: () => repo.get('appearance') ?? DEFAULT_APPEARANCE,
    getInstanceName: () => repo.getAppearance().instanceName || DEFAULT_INSTANCE_NAME,
    isSetupCompleted: () => repo.get('setup_completed') === true,
  };
  return repo;
}
