import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { UPLOAD_STATUSES } from '@easysend/shared';
import { createdAtColumn } from './_helpers.js';
import { transfers } from './transfers.js';
import { users } from './users.js';

export const uploads = sqliteTable(
  'uploads',
  {
    /** The tus upload id. */
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Null until the upload is attached to a transfer. */
    transferId: text('transfer_id').references(() => transfers.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    totalSize: integer('total_size').notNull(),
    status: text('status', { enum: UPLOAD_STATUSES }).notNull().default('in_progress'),
    createdAt: createdAtColumn(),
    lastActivityAt: integer('last_activity_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    index('uploads_owner_id_idx').on(table.ownerId),
    index('uploads_status_expires_at_idx').on(table.status, table.expiresAt),
    index('uploads_transfer_id_idx').on(table.transferId),
  ],
);
