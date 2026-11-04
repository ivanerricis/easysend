import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { STORAGE_DRIVERS, STORAGE_MIGRATION_STATUSES } from '@easysend/shared';
import { createdAtColumn, idColumn, nowSeconds } from './_helpers.js';
import { users } from './users.js';

/** One run of the "move the stored files to another driver" job (panel or CLI). */
export const storageMigrations = sqliteTable(
  'storage_migrations',
  {
    id: idColumn(),
    target: text('target', { enum: STORAGE_DRIVERS }).notNull(),
    status: text('status', { enum: STORAGE_MIGRATION_STATUSES }).notNull(),
    totalFiles: integer('total_files').notNull().default(0),
    doneFiles: integer('done_files').notNull().default(0),
    totalBytes: integer('total_bytes').notNull().default(0),
    doneBytes: integer('done_bytes').notNull().default(0),
    failedFiles: integer('failed_files').notNull().default(0),
    errorCode: text('error_code'),
    startedBy: text('started_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: integer('started_at')
      .notNull()
      .$defaultFn(() => nowSeconds()),
    updatedAt: integer('updated_at')
      .notNull()
      .$defaultFn(() => nowSeconds()),
    finishedAt: integer('finished_at'),
  },
  (table) => [index('storage_migrations_status_idx').on(table.status)],
);

/** Deferred and retried object deletions: migrated sources (grace period) and failed S3 deletes. */
export const storageDeletions = sqliteTable(
  'storage_deletions',
  {
    id: idColumn(),
    storage: text('storage', { enum: STORAGE_DRIVERS }).notNull(),
    /** Object name (`transfer_files.storage_name`). */
    name: text('name').notNull(),
    /** Unix seconds: not deleted before this moment. */
    deleteAfter: integer('delete_after').notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (table) => [index('storage_deletions_delete_after_idx').on(table.deleteAfter)],
);
