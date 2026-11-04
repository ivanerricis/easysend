import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  ALLOWED_IMAGE_TYPES,
  BRANDING_ASSET_KINDS,
  DEFAULT_APPEARANCE,
  appearanceSchema,
  generalSettingsSchema,
  smtpSettingsSchema,
  s3ConfigSchema,
  storageDriverSchema,
  storageSourceSchema,
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

/**
 * `emailLogo` is not a public asset kind: it is the PNG rendition of the light logo embedded in
 * emails (always PNG, hence no content type).
 */
export const emailLogoEntrySchema = brandingAssetEntrySchema.omit({ contentType: true });

const brandingAssetsSettingSchema = z.object({
  ...(Object.fromEntries(
    BRANDING_ASSET_KINDS.map((kind) => [kind, brandingAssetEntrySchema.optional()]),
  ) as Record<BrandingAssetKind, z.ZodOptional<typeof brandingAssetEntrySchema>>),
  emailLogo: emailLogoEntrySchema.optional(),
});
/** Absent key = built-in default for that asset. */
export type BrandingAssetsSetting = z.infer<typeof brandingAssetsSettingSchema>;

/**
 * File storage configuration. Encrypted as a whole (it holds the S3 secret key). `s3` is kept
 * when the driver goes back to `local`, so the admin can switch again without retyping it.
 */
export const storageSettingSchema = z.object({
  driver: storageDriverSchema,
  s3: s3ConfigSchema.optional(),
  /** `env`: imported from the `.env` file at the first start; `panel`: saved by the wizard or panel. */
  source: storageSourceSchema,
});
export type StorageSetting = z.infer<typeof storageSettingSchema>;

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
  storage: storageSettingSchema,
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
  storage: StorageSetting;
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
  storage: 'storage',
};

export const DEFAULT_LOCALE: Locale = 'it';
export const DEFAULT_INSTANCE_NAME = 'EasySend';

export interface SettingsRepo {
  /** Typed read. Undefined when missing or when the stored value no longer matches its schema. */
  get<K extends SettingKey>(key: K): SettingValues[K] | undefined;
  set<K extends SettingKey>(key: K, value: SettingInputs[K]): void;
  delete(key: SettingKey): void;
  /** True when a row exists for the key (without reading, decrypting or validating its value). */
  has(key: SettingKey): boolean;
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
  keys: Pick<DerivedKeys, 'smtp' | 'totp' | 'storage'>;
  clock: Clock;
}): SettingsRepo {
  const { db, keys, clock } = deps;
  const keyFor = (purpose: KeyPurpose): Buffer => {
    if (purpose === 'smtp') return keys.smtp;
    if (purpose === 'totp') return keys.totp;
    if (purpose === 'storage') return keys.storage;
    throw new Error(`No key available for setting purpose ${purpose}`);
  };

  // Read-through cache: a single API process owns the database (CLIs run with the API stopped),
  // and every write goes through `set` / `delete`, which drop the entry. Values are cloned on
  // the way out so callers cannot corrupt it.
  const cache = new Map<SettingKey, { value: unknown }>();

  const read = <K extends SettingKey>(key: K): SettingValues[K] | undefined => {
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
    return parsed.success ? (parsed.data as SettingValues[K]) : undefined;
  };

  const repo: SettingsRepo = {
    get(key) {
      let entry = cache.get(key);
      if (!entry) {
        entry = { value: read(key) };
        cache.set(key, entry);
      }
      return entry.value === undefined ? undefined : structuredClone(entry.value as never);
    },

    set(key, value) {
      const purpose = ENCRYPTED_KEYS[key];
      const stored = purpose
        ? encryptSecret(keyFor(purpose), purpose, JSON.stringify(value))
        : value;
      const updatedAt = nowSeconds(clock);
      const isEncrypted = purpose !== undefined;
      cache.delete(key);
      db.insert(settings)
        .values({ key, value: stored, isEncrypted, updatedAt })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: stored, isEncrypted, updatedAt },
        })
        .run();
    },

    delete(key) {
      cache.delete(key);
      db.delete(settings).where(eq(settings.key, key)).run();
    },

    has(key) {
      return (
        db.select({ key: settings.key }).from(settings).where(eq(settings.key, key)).get() !==
        undefined
      );
    },

    getDefaultLocale: () => repo.get('general')?.defaultLocale ?? DEFAULT_LOCALE,
    getAppearance: () => repo.get('appearance') ?? DEFAULT_APPEARANCE,
    getInstanceName: () => repo.getAppearance().instanceName || DEFAULT_INSTANCE_NAME,
    isSetupCompleted: () => repo.get('setup_completed') === true,
  };
  return repo;
}
