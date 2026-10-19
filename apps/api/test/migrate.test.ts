import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/client.js';
import { resolveMigrationsFolder, runMigrations } from '../src/db/migrate.js';
import { makeTempDir, migratedMemoryDb, silentLogger, trackDb } from './helpers.js';

const TABLES = [
  'audit_log',
  'download_logs',
  'password_reset_tokens',
  'recovery_codes',
  'sessions',
  'settings',
  'transfer_files',
  'transfer_recipients',
  'transfers',
  'uploads',
  'users',
];

const INDEXES = [
  'users_email_unique',
  'sessions_user_id_idx',
  'sessions_expires_at_idx',
  'password_reset_tokens_token_hash_unique',
  'password_reset_tokens_user_id_idx',
  'password_reset_tokens_expires_at_idx',
  'recovery_codes_user_id_idx',
  'transfers_token_unique',
  'transfers_owner_id_idx',
  'transfers_status_expires_at_idx',
  'transfer_files_transfer_id_idx',
  'transfer_recipients_transfer_id_idx',
  'uploads_owner_id_idx',
  'uploads_status_expires_at_idx',
  'uploads_transfer_id_idx',
  'download_logs_transfer_id_idx',
  'download_logs_created_at_idx',
  'audit_log_created_at_idx',
  'audit_log_actor_id_idx',
  'audit_log_action_idx',
];

function names(
  sqlite: ReturnType<typeof openDatabase>['sqlite'],
  type: 'table' | 'index',
): string[] {
  const rows = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%'")
    .all(type) as { name: string }[];
  return rows.map((row) => row.name);
}

describe('migrations', () => {
  it('creates all tables and indexes', async () => {
    const { sqlite } = await migratedMemoryDb();
    const tables = names(sqlite, 'table').filter((name) => name !== '__drizzle_migrations');
    expect(tables.sort()).toEqual(TABLES);
    expect(names(sqlite, 'index')).toEqual(expect.arrayContaining(INDEXES));
  });

  it('sets WAL and foreign keys on a file database', () => {
    const file = path.join(makeTempDir(), 'app.sqlite');
    const { sqlite } = trackDb(openDatabase(file));
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('is a no-op on the second run and does not back up a fresh database', async () => {
    const dir = makeTempDir();
    const backupDir = path.join(dir, 'backups');
    const { sqlite } = trackDb(openDatabase(path.join(dir, 'app.sqlite')));
    const options = {
      migrationsFolder: resolveMigrationsFolder(),
      backupDir,
      logger: silentLogger,
    };

    const first = await runMigrations(sqlite, options);
    expect(first.applied).toEqual(['0000_init', '0001_auth_sessions']);
    expect(first.backupPath).toBeUndefined();

    const second = await runMigrations(sqlite, options);
    expect(second.applied).toEqual([]);
    expect(second.backupPath).toBeUndefined();
    expect(existsSync(backupDir)).toBe(false);
  });

  it('backs up a non-empty database before applying a pending migration', async () => {
    const dir = makeTempDir();
    const backupDir = path.join(dir, 'backups');
    const { sqlite } = trackDb(openDatabase(path.join(dir, 'app.sqlite')));
    const base = resolveMigrationsFolder();
    await runMigrations(sqlite, { migrationsFolder: base, backupDir, logger: silentLogger });
    sqlite.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('k', '1', 1)").run();

    // Copy the real migrations and append an extra one.
    const extended = path.join(dir, 'drizzle');
    cpSync(base, extended, { recursive: true });
    writeFileSync(path.join(extended, '0002_extra.sql'), 'CREATE TABLE extra (id integer);\n');
    const journalFile = path.join(extended, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as {
      entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
    };
    const last = journal.entries[journal.entries.length - 1];
    journal.entries.push({
      idx: journal.entries.length,
      version: last?.version ?? '6',
      when: (last?.when ?? 0) + 1000,
      tag: '0002_extra',
      breakpoints: true,
    });
    writeFileSync(journalFile, JSON.stringify(journal));

    const result = await runMigrations(sqlite, {
      migrationsFolder: extended,
      backupDir,
      logger: silentLogger,
    });

    expect(result.applied).toEqual(['0002_extra']);
    expect(result.backupPath).toBeDefined();
    expect(path.basename(result.backupPath ?? '')).toMatch(/^app-pre-0002_extra-.+\.sqlite$/);
    expect(names(sqlite, 'table')).toContain('extra');

    // The backup holds the pre-migration state: data present, new table absent.
    const backup = trackDb(openDatabase(result.backupPath ?? ''));
    expect(names(backup.sqlite, 'table')).not.toContain('extra');
    expect(backup.sqlite.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 1 });
  });

  it('keeps only the latest 5 backups', async () => {
    const dir = makeTempDir();
    const backupDir = path.join(dir, 'backups');
    const { sqlite } = trackDb(openDatabase(path.join(dir, 'app.sqlite')));
    const base = resolveMigrationsFolder();
    await runMigrations(sqlite, { migrationsFolder: base, backupDir, logger: silentLogger });

    const extended = path.join(dir, 'drizzle');
    cpSync(base, extended, { recursive: true });
    const journalFile = path.join(extended, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as {
      entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
    };
    const first = journal.entries[journal.entries.length - 1];
    const baseCount = journal.entries.length;
    for (let i = 1; i <= 7; i++) {
      const tag = `010${i}_t${i}`;
      writeFileSync(path.join(extended, `${tag}.sql`), `CREATE TABLE t${i} (id integer);\n`);
      journal.entries.push({
        idx: baseCount + i - 1,
        version: first?.version ?? '6',
        when: (first?.when ?? 0) + i * 1000,
        tag,
        breakpoints: true,
      });
      writeFileSync(journalFile, JSON.stringify(journal));
      await runMigrations(sqlite, { migrationsFolder: extended, backupDir, logger: silentLogger });
    }

    expect(readdirSync(backupDir)).toHaveLength(5);
  });

  it('applies 0001 on a database that already has 0000 and rows in sessions', async () => {
    const dir = makeTempDir();
    const backupDir = path.join(dir, 'backups');
    const { sqlite } = trackDb(openDatabase(path.join(dir, 'app.sqlite')));
    const full = resolveMigrationsFolder();

    // A folder holding only 0000: the state of a database created by phase 1.
    const onlyInit = path.join(dir, 'drizzle-0000');
    cpSync(full, onlyInit, { recursive: true });
    const journalFile = path.join(onlyInit, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 1);
    writeFileSync(journalFile, JSON.stringify(journal));
    await runMigrations(sqlite, { migrationsFolder: onlyInit, backupDir, logger: silentLogger });

    sqlite
      .prepare(
        "INSERT INTO users (id, email, password_hash, created_at) VALUES ('u', 'a@b.c', 'h', 1)",
      )
      .run();
    sqlite
      .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s', 'u', 9, 1)")
      .run();

    const result = await runMigrations(sqlite, {
      migrationsFolder: full,
      backupDir,
      logger: silentLogger,
    });

    expect(result.applied).toEqual(['0001_auth_sessions']);
    expect(sqlite.prepare('SELECT last_seen_at, absolute_expires_at FROM sessions').get()).toEqual({
      last_seen_at: 0,
      absolute_expires_at: 0,
    });
    expect(sqlite.prepare('SELECT totp_last_counter FROM users').get()).toEqual({
      totp_last_counter: null,
    });
  });

  it('cascades from transfers to transfer_files and restricts user deletion', async () => {
    const { sqlite } = await migratedMemoryDb();
    sqlite
      .prepare(
        "INSERT INTO users (id, email, password_hash, role, created_at) VALUES ('u1', 'a@b.c', 'h', 'admin', 1)",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO transfers (id, owner_id, token, mode, expires_at, status, created_at) VALUES ('t1', 'u1', 'tok', 'link', 100, 'active', 1)",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO transfer_files (id, transfer_id, original_name, storage_name, size_bytes, stored_size_bytes, enc_key_wrapped, enc_nonce_prefix, enc_segment_size, enc_version, created_at) VALUES ('f1', 't1', 'a.txt', 's', 1, 2, 'k', 'n', 65536, 1, 1)",
      )
      .run();

    expect(() => sqlite.prepare("DELETE FROM users WHERE id = 'u1'").run()).toThrow(/FOREIGN KEY/);

    sqlite.prepare("DELETE FROM transfers WHERE id = 't1'").run();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM transfer_files').get()).toEqual({ n: 0 });
  });
});
