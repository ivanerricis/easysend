import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  appearanceSchema,
  generalSettingsSchema,
  smtpSettingsSchema,
  type Appearance,
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

/** Known setting keys with their value schema. Values are stored as JSON. */
const SETTING_SCHEMAS = {
  smtp: smtpSettingsSchema,
  general: generalSettingsSchema,
  appearance: appearanceSchema,
  setup_completed: z.boolean(),
} as const;

export interface SettingValues {
  smtp: SmtpSettings;
  general: GeneralSettings;
  appearance: Appearance;
  setup_completed: boolean;
}
export type SettingKey = keyof SettingValues;

/** Keys whose whole JSON value is encrypted at rest (`is_encrypted = 1`), with the key purpose. */
export const ENCRYPTED_KEYS: Partial<Record<SettingKey, KeyPurpose>> = { smtp: 'smtp' };

export const DEFAULT_LOCALE: Locale = 'it';
export const DEFAULT_INSTANCE_NAME = 'EasySend';

export interface SettingsRepo {
  /** Typed read. Undefined when missing or when the stored value no longer matches its schema. */
  get<K extends SettingKey>(key: K): SettingValues[K] | undefined;
  set<K extends SettingKey>(key: K, value: SettingValues[K]): void;
  delete(key: SettingKey): void;
  /** Instance default language (`general.defaultLocale`), `it` when unset. */
  getDefaultLocale(): Locale;
  /** Instance name (`appearance.instanceName`), `EasySend` when unset. */
  getInstanceName(): string;
}

export function createSettingsRepo(deps: {
  db: Db;
  keys: Pick<DerivedKeys, 'smtp'>;
  clock: Clock;
}): SettingsRepo {
  const { db, keys, clock } = deps;
  const keyFor = (purpose: KeyPurpose): Buffer => {
    if (purpose === 'smtp') return keys.smtp;
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
    getInstanceName: () => repo.get('appearance')?.instanceName ?? DEFAULT_INSTANCE_NAME,
  };
  return repo;
}
