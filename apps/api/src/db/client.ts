import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index.js';

export type Db = BetterSQLite3Database<typeof schema>;
export type SqliteDatabase = Database.Database;

export interface DbHandle {
  sqlite: SqliteDatabase;
  db: Db;
}

/** Opens the SQLite file (or `:memory:`) with the PRAGMAs the app relies on. */
export function openDatabase(file: string): DbHandle {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}
