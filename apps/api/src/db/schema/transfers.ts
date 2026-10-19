import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { TRANSFER_MODES, TRANSFER_STATUSES } from '@easysend/shared';
import { createdAtColumn, idColumn } from './_helpers.js';
import { users } from './users.js';

export const transfers = sqliteTable(
  'transfers',
  {
    id: idColumn(),
    /** Restrict: an admin reassigns or deletes transfers explicitly before removing a user. */
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    token: text('token').notNull(),
    title: text('title'),
    message: text('message'),
    mode: text('mode', { enum: TRANSFER_MODES }).notNull(),
    expiresAt: integer('expires_at').notNull(),
    passwordHash: text('password_hash'),
    maxDownloads: integer('max_downloads'),
    downloadCount: integer('download_count').notNull().default(0),
    totalBytes: integer('total_bytes').notNull().default(0),
    status: text('status', { enum: TRANSFER_STATUSES }).notNull().default('uploading'),
    createdAt: createdAtColumn(),
    firstDownloadedAt: integer('first_downloaded_at'),
    notifiedAt: integer('notified_at'),
  },
  (table) => [
    uniqueIndex('transfers_token_unique').on(table.token),
    index('transfers_owner_id_idx').on(table.ownerId),
    index('transfers_status_expires_at_idx').on(table.status, table.expiresAt),
  ],
);

export const transferFiles = sqliteTable(
  'transfer_files',
  {
    id: idColumn(),
    transferId: text('transfer_id')
      .notNull()
      .references(() => transfers.id, { onDelete: 'cascade' }),
    originalName: text('original_name').notNull(),
    storageName: text('storage_name').notNull(),
    /** Plaintext size in bytes. */
    sizeBytes: integer('size_bytes').notNull(),
    /** Size on disk after encryption. */
    storedSizeBytes: integer('stored_size_bytes').notNull(),
    mimeType: text('mime_type'),
    sha256: text('sha256'),
    encKeyWrapped: text('enc_key_wrapped').notNull(),
    encNoncePrefix: text('enc_nonce_prefix').notNull(),
    encSegmentSize: integer('enc_segment_size').notNull(),
    encVersion: integer('enc_version').notNull().default(1),
    createdAt: createdAtColumn(),
  },
  (table) => [index('transfer_files_transfer_id_idx').on(table.transferId)],
);

export const transferRecipients = sqliteTable(
  'transfer_recipients',
  {
    id: idColumn(),
    transferId: text('transfer_id')
      .notNull()
      .references(() => transfers.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    notifiedAt: integer('notified_at'),
  },
  (table) => [index('transfer_recipients_transfer_id_idx').on(table.transferId)],
);
