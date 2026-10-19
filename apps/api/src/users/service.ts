import { and, count, eq } from 'drizzle-orm';
import type { AdminUser, MeResponse, User } from '@easysend/shared';
import { generateRecoveryCodes, hashRecoveryCode } from '../auth/recovery-codes.js';
import type { UserRow } from '../auth/session.js';
import type { AppContext } from '../context.js';
import type { Db } from '../db/client.js';
import { recoveryCodes, users } from '../db/schema/index.js';

/** Email as stored and compared: trimmed and lower-case (same normalization as the login). */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Public user. `locale` falls back to the instance default (plan decision 11). */
export function toUser(ctx: Pick<AppContext, 'settings'>, row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    locale: row.locale ?? ctx.settings.getDefaultLocale(),
    themePreference: row.themePreference,
    totpEnabled: row.totpEnabled,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
  };
}

export function toMe(ctx: Pick<AppContext, 'settings'>, row: UserRow): MeResponse {
  return { user: toUser(ctx, row), usedBytes: row.usedBytes, quotaBytes: row.quotaBytes };
}

export function toAdminUser(
  ctx: Pick<AppContext, 'settings'>,
  row: UserRow,
  transferCount: number,
): AdminUser {
  return {
    ...toUser(ctx, row),
    disabled: row.disabled,
    usedBytes: row.usedBytes,
    quotaBytes: row.quotaBytes,
    transferCount,
  };
}

/** Deletes the user's recovery codes and inserts a fresh set. Returns the plain codes (shown once). */
export function replaceRecoveryCodes(
  ctx: Pick<AppContext, 'keys'>,
  db: Pick<Db, 'insert' | 'delete'>,
  userId: string,
): string[] {
  const codes = generateRecoveryCodes();
  db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)).run();
  db.insert(recoveryCodes)
    .values(
      codes.map((code) => ({ userId, codeHash: hashRecoveryCode(ctx.keys.recoveryCode, code) })),
    )
    .run();
  return codes;
}

/** Removes secret, replay counter and recovery codes and turns 2FA off. */
export function clearTwoFactor(db: Pick<Db, 'update' | 'delete'>, userId: string): void {
  db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)).run();
  db.update(users)
    .set({ totpSecretEnc: null, totpLastCounter: null, totpEnabled: false })
    .where(eq(users.id, userId))
    .run();
}

/** Admins that can still log in. */
export function countActiveAdmins(db: Pick<Db, 'select'>): number {
  const row = db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.disabled, false)))
    .get();
  return row?.n ?? 0;
}
