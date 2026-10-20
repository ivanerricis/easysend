import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBackupDb } from '../src/cli/backup-db.js';
import { runRestoreDb } from '../src/cli/restore-db.js';
import { BackupError, createManualBackup } from '../src/db/backup.js';
import { openDatabase } from '../src/db/client.js';
import { makeTempDir, silentLogger } from './helpers.js';

function cliEnv() {
  const dir = makeTempDir();
  const dbPath = path.join(dir, 'db', 'app.sqlite');
  mkdirSync(path.dirname(dbPath), { recursive: true });
  return {
    dbPath,
    backupDir: path.join(dir, 'db', 'backups'),
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      APP_MODE: 'local',
      DATA_DIR: dir,
      DB_PATH: dbPath,
    },
  };
}

function seed(dbPath: string, value: string): void {
  const { sqlite } = openDatabase(dbPath);
  try {
    sqlite.exec('CREATE TABLE IF NOT EXISTS notes (v TEXT)');
    sqlite.exec('DELETE FROM notes');
    sqlite.prepare('INSERT INTO notes (v) VALUES (?)').run(value);
  } finally {
    sqlite.close();
  }
}

function read(dbPath: string): string[] {
  const { sqlite } = openDatabase(dbPath);
  try {
    return (sqlite.prepare('SELECT v FROM notes').all() as { v: string }[]).map((r) => r.v);
  } finally {
    sqlite.close();
  }
}

describe('db backup and restore CLIs', () => {
  it('backs up while a connection is open, then restores the backup', async () => {
    const { dbPath, backupDir, env } = cliEnv();
    seed(dbPath, 'original');
    // A live connection with uncheckpointed WAL content, like the running api.
    const live = openDatabase(dbPath);
    live.sqlite.prepare('INSERT INTO notes (v) VALUES (?)').run('in wal');
    let name: string;
    try {
      name = await runBackupDb(env);
    } finally {
      live.sqlite.close();
    }
    expect(name).toMatch(/^manual-\d{8}T\d{6}\.sqlite$/);
    expect(existsSync(path.join(backupDir, name))).toBe(true);

    seed(dbPath, 'changed later');
    const result = await runRestoreDb(name, env);
    expect(result.restored).toBe(name);
    expect(result.previousCopy).toMatch(/^app-pre-restore-\d{8}T\d{6}\.sqlite$/);
    expect(read(dbPath).sort()).toEqual(['in wal', 'original']);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(readdirSync(path.dirname(dbPath)).filter((f) => f.endsWith('.tmp'))).toEqual([]);

    // The replaced database stays available as a backup.
    const previous = openDatabase(path.join(backupDir, result.previousCopy!));
    try {
      expect(previous.sqlite.prepare('SELECT v FROM notes').all()).toEqual([
        { v: 'changed later' },
      ]);
    } finally {
      previous.sqlite.close();
    }
  });

  it('never overwrites a backup taken in the same second', async () => {
    const { dbPath, backupDir } = cliEnv();
    seed(dbPath, 'x');
    const { sqlite } = openDatabase(dbPath);
    try {
      const at = new Date('2026-01-02T03:04:05Z');
      const a = await createManualBackup(sqlite, backupDir, silentLogger, at);
      const b = await createManualBackup(sqlite, backupDir, silentLogger, at);
      expect(a).toBe('manual-20260102T030405.sqlite');
      expect(b).toBe('manual-20260102T030405-2.sqlite');
    } finally {
      sqlite.close();
    }
  });

  it('keeps the newest 10 manual backups and leaves migration backups alone', async () => {
    const { dbPath, backupDir } = cliEnv();
    seed(dbPath, 'x');
    const { sqlite } = openDatabase(dbPath);
    try {
      const names: string[] = [];
      for (let i = 0; i < 12; i += 1) {
        const at = new Date(Date.UTC(2026, 0, 1, 0, 0, i));
        const name = await createManualBackup(sqlite, backupDir, silentLogger, at);
        // Distinct, increasing mtimes: pruning goes by modification time.
        utimesSync(
          path.join(backupDir, name),
          new Date(2026, 0, 1, 0, 0, i),
          new Date(2026, 0, 1, 0, 0, i),
        );
        names.push(name);
        if (i === 0)
          writeFileSync(path.join(backupDir, 'app-pre-0001_x-20260101T000000.sqlite'), '');
      }
      const left = readdirSync(backupDir).filter((f) => f.startsWith('manual-'));
      expect(left).toHaveLength(10);
      expect(left).not.toContain(names[0]);
      expect(readdirSync(backupDir)).toContain('app-pre-0001_x-20260101T000000.sqlite');
    } finally {
      sqlite.close();
    }
  });

  it('rejects paths, odd names, missing and corrupt backups', async () => {
    const { dbPath, backupDir, env } = cliEnv();
    seed(dbPath, 'keep me');
    const bad = [
      '../app.sqlite',
      '..\\app.sqlite',
      '/etc/passwd',
      'sub/manual-20260101T000000.sqlite',
      'app.sqlite',
      'manual-20260101T000000.sqlite.bak',
      'app-pre-..sqlite',
      '',
    ];
    for (const name of bad) {
      await expect(runRestoreDb(name, env), name).rejects.toBeInstanceOf(BackupError);
    }
    await expect(runRestoreDb('manual-20260101T000000.sqlite', env)).rejects.toThrow(/not found/i);

    // Right name, not a SQLite file.
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(
      path.join(backupDir, 'manual-20260101T000001.sqlite'),
      'this is not sqlite data'.repeat(50),
    );
    await expect(runRestoreDb('manual-20260101T000001.sqlite', env)).rejects.toThrow(
      /not a valid sqlite/i,
    );
    expect(read(dbPath)).toEqual(['keep me']);
  });

  it('refuses to restore while another connection is writing', async () => {
    const { dbPath, backupDir, env } = cliEnv();
    seed(dbPath, 'before');
    const { sqlite } = openDatabase(dbPath);
    const name = await createManualBackup(sqlite, backupDir, silentLogger);
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      await expect(runRestoreDb(name, env)).rejects.toThrow(/in use/i);
    } finally {
      sqlite.exec('ROLLBACK');
      sqlite.close();
    }
    expect(read(dbPath)).toEqual(['before']);
  });
});
