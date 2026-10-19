import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { nowSeconds } from './_helpers.js';

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  isEncrypted: integer('is_encrypted', { mode: 'boolean' }).notNull().default(false),
  updatedAt: integer('updated_at')
    .notNull()
    .$defaultFn(() => nowSeconds()),
});
