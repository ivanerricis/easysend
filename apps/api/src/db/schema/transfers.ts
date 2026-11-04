import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import {
  EXPIRY_KEYS,
  TRANSFER_MODES,
  TRANSFER_SOURCES,
  TRANSFER_STATUSES,
  UPLOAD_REQUEST_STATUSES,
} from '@easysend/shared';
import { createdAtColumn, idColumn, nowSeconds } from './_helpers.js';
import { users } from './users.js';

/** Link that lets anyone without an account send files to the owner. */
export const uploadRequests = sqliteTable(
  'upload_requests',
  {
    id: idColumn(),
    /** Restrict: an admin reassigns or deletes requests explicitly before removing a user. */
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    token: text('token').notNull(),
    title: text('title').notNull(),
    /** Instructions shown to the people who upload. */
    message: text('message'),
    passwordHash: text('password_hash'),
    maxTotalBytes: integer('max_total_bytes'),
    maxSubmissions: integer('max_submissions'),
    requireName: integer('require_name', { mode: 'boolean' }).notNull().default(false),
    requireEmail: integer('require_email', { mode: 'boolean' }).notNull().default(false),
    expiresAt: integer('expires_at').notNull(),
    /** Duration chosen by the owner: validity of the link and lifetime of each received transfer. */
    expiresIn: text('expires_in', { enum: EXPIRY_KEYS }).notNull(),
    /** `expired` is derived from `expires_at`, never stored. */
    status: text('status', { enum: UPLOAD_REQUEST_STATUSES }).notNull().default('active'),
    /** Finalized submissions. */
    submissionCount: integer('submission_count').notNull().default(0),
    /** Plaintext bytes of the files received through finalized submissions. */
    receivedBytes: integer('received_bytes').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: integer('updated_at')
      .notNull()
      .$defaultFn(() => nowSeconds()),
  },
  (table) => [
    uniqueIndex('upload_requests_token_unique').on(table.token),
    index('upload_requests_owner_id_idx').on(table.ownerId),
    index('upload_requests_status_expires_at_idx').on(table.status, table.expiresAt),
  ],
);

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
    /** `received` when the files were uploaded by someone else through an upload request. */
    source: text('source', { enum: TRANSFER_SOURCES }).notNull().default('sent'),
    /** Set null when the request is deleted: received transfers outlive it. */
    uploadRequestId: text('upload_request_id').references(() => uploadRequests.id, {
      onDelete: 'set null',
    }),
    senderName: text('sender_name'),
    senderEmail: text('sender_email'),
  },
  (table) => [
    uniqueIndex('transfers_token_unique').on(table.token),
    index('transfers_owner_id_idx').on(table.ownerId),
    index('transfers_status_expires_at_idx').on(table.status, table.expiresAt),
    index('transfers_upload_request_id_idx').on(table.uploadRequestId),
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
