import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createdAtColumn, idColumn } from './_helpers.js';
import { transfers } from './transfers.js';

export const downloadLogs = sqliteTable(
  'download_logs',
  {
    id: idColumn(),
    transferId: text('transfer_id')
      .notNull()
      .references(() => transfers.id, { onDelete: 'cascade' }),
    /** Plain text, no FK: the log row is removed with the transfer, not with the single file. */
    fileId: text('file_id'),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    bytesSent: integer('bytes_sent').notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('download_logs_transfer_id_idx').on(table.transferId),
    index('download_logs_created_at_idx').on(table.createdAt),
  ],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: idColumn(),
    /** Plain text, no FK, so history survives user deletion. */
    actorId: text('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    /** JSON without sensitive data. */
    metadata: text('metadata', { mode: 'json' }),
    ipHash: text('ip_hash'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('audit_log_created_at_idx').on(table.createdAt),
    index('audit_log_actor_id_idx').on(table.actorId),
    index('audit_log_action_idx').on(table.action),
  ],
);
