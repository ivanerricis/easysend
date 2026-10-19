import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { LOCALES, THEME_PREFERENCES, USER_ROLES } from '@easysend/shared';
import { createdAtColumn, idColumn } from './_helpers.js';

export const users = sqliteTable(
  'users',
  {
    id: idColumn(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull().default('user'),
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
    /** Null means unlimited. */
    quotaBytes: integer('quota_bytes'),
    usedBytes: integer('used_bytes').notNull().default(0),
    locale: text('locale', { enum: LOCALES }),
    /** Null means follow the instance default. */
    themePreference: text('theme_preference', { enum: THEME_PREFERENCES }),
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAtColumn(),
    lastLoginAt: integer('last_login_at'),
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
);

export const recoveryCodes = sqliteTable(
  'recovery_codes',
  {
    id: idColumn(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: integer('used_at'),
  },
  (table) => [index('recovery_codes_user_id_idx').on(table.userId)],
);

export const passwordResetTokens = sqliteTable(
  'password_reset_tokens',
  {
    id: idColumn(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('password_reset_tokens_token_hash_unique').on(table.tokenHash),
    index('password_reset_tokens_user_id_idx').on(table.userId),
    index('password_reset_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    /** SHA-256 hash of the session token. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
    createdAt: createdAtColumn(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    mfaVerified: integer('mfa_verified', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);
