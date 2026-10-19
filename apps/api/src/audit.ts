import type { Db } from './db/client.js';
import { auditLog } from './db/schema/index.js';

/** Stable action names stored in `audit_log.action` (phase 2 plan, decision 14). */
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.lockout',
  'auth.2fa_enabled',
  'auth.2fa_disabled',
  'auth.recovery_used',
  'auth.recovery_regenerated',
  'auth.password_changed',
  'auth.password_reset_requested',
  'auth.password_reset',
  'admin.user_created',
  'admin.user_updated',
  'admin.user_deleted',
  'admin.2fa_reset',
  'transfer.created',
  'transfer.finalized',
  'transfer.updated',
  'transfer.revoked',
  'transfer.deleted',
  'transfer.file_deleted',
  'transfer.resent',
  'system.key_rotated',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  /** User who performed the action; null for anonymous actions (failed login, reset request). */
  actorId: string | null;
  action: AuditAction;
  targetType?: 'user' | 'session' | 'transfer';
  targetId?: string;
  /** JSON-serializable and free of sensitive data: never passwords, codes, tokens or emails of unknown users. */
  metadata?: Record<string, unknown>;
  /** HMAC of the client IP, never the address itself. */
  ipHash?: string | null;
  /** Unix seconds from the injected clock. */
  now: number;
}

/** Writes one audit row synchronously. Pass the transaction handle to make it atomic with the change. */
export function audit(db: Pick<Db, 'insert'>, entry: AuditEntry): void {
  db.insert(auditLog)
    .values({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
      ipHash: entry.ipHash ?? null,
      createdAt: entry.now,
    })
    .run();
}
