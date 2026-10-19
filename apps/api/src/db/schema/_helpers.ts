import { randomUUID } from 'node:crypto';
import { integer, text } from 'drizzle-orm/sqlite-core';

/** Random text primary key. */
export const idColumn = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());

/** Current time as Unix seconds. */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** `created_at` column: Unix seconds, set on insert. */
export const createdAtColumn = () =>
  integer('created_at')
    .notNull()
    .$defaultFn(() => nowSeconds());
