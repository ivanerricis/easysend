import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { RotateKeyError, runRotateKey } from '../src/cli/rotate-key.js';
import { decryptSecret, encryptSecret } from '../src/crypto/aead.js';
import { deriveKey } from '../src/crypto/keys.js';
import { createDecryptStream, encryptFile } from '../src/crypto/segments.js';
import { openDatabase } from '../src/db/client.js';
import { resolveMigrationsFolder, runMigrations } from '../src/db/migrate.js';
import { auditLog, settings, transferFiles, transfers, users } from '../src/db/schema/index.js';
import { parseKey } from '../src/secrets.js';
import { createSettingsRepo } from '../src/settings/repo.js';
import { makeTempDir, silentLogger } from './helpers.js';

const PLAINTEXT = 'secret file content for rotation';
const PENDING_ADMIN = {
  email: 'admin@example.com',
  displayName: null,
  passwordHash: 'hash',
  totpSecret: 'JBSWY3DPEHPK3PXP',
  createdAt: 1_700_000_000,
};

const SMTP = {
  host: 'smtp.example.com',
  port: 587,
  security: 'starttls',
  fromEmail: 'noreply@example.com',
  password: 'smtp-password-123',
} as const;

interface Fixture {
  dir: string;
  dbPath: string;
  oldKey: Buffer;
  env: Record<string, string>;
  storagePath: string;
  fileId: string;
}

async function fixture(
  options: { envKey?: boolean; foreignTotp?: boolean } = {},
): Promise<Fixture> {
  const dir = makeTempDir();
  const dbPath = path.join(dir, 'db', 'app.sqlite');
  mkdirSync(path.dirname(dbPath), { recursive: true });
  mkdirSync(path.join(dir, 'secrets'), { recursive: true });
  const oldKey = randomBytes(32);
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    APP_MODE: 'local',
    DATA_DIR: dir,
  };
  if (options.envKey) env['APP_SECRET_KEY'] = oldKey.toString('hex');
  else writeFileSync(path.join(dir, 'secrets', 'app.key'), `${oldKey.toString('hex')}\n`);

  const handle = openDatabase(dbPath);
  try {
    await runMigrations(handle.sqlite, {
      migrationsFolder: resolveMigrationsFolder(),
      backupDir: path.join(dir, 'b'),
      logger: silentLogger,
    });
    const totpOwner = options.foreignTotp ? randomBytes(32) : oldKey;
    const user = handle.db
      .insert(users)
      .values({
        email: 'a@example.com',
        passwordHash: 'x',
        totpEnabled: true,
        totpSecretEnc: encryptSecret(deriveKey(totpOwner, 'totp'), 'totp', 'JBSWY3DPEHPK3PXP'),
      })
      .returning({ id: users.id })
      .get();
    const oldRepo = createSettingsRepo({
      db: handle.db,
      keys: { smtp: deriveKey(oldKey, 'smtp'), totp: deriveKey(oldKey, 'totp') },
      clock: () => Date.now(),
    });
    oldRepo.set('smtp', { ...SMTP });
    oldRepo.set('setup_admin_pending', PENDING_ADMIN);

    const transfer = handle.db
      .insert(transfers)
      .values({ ownerId: user.id, token: 't', mode: 'link', expiresAt: 9_999_999_999 })
      .returning({ id: transfers.id })
      .get();
    const src = path.join(dir, 'plain');
    writeFileSync(src, PLAINTEXT);
    const storageName = randomUUID();
    const storagePath = path.join(dir, storageName);
    const enc = await encryptFile({
      srcPath: src,
      dstPath: storagePath,
      size: PLAINTEXT.length,
      fileKey: deriveKey(oldKey, 'file'),
    });
    const file = handle.db
      .insert(transferFiles)
      .values({
        transferId: transfer.id,
        originalName: 'f.txt',
        storageName,
        sizeBytes: PLAINTEXT.length,
        storedSizeBytes: enc.storedSize,
        encKeyWrapped: enc.wrappedKey,
        encNoncePrefix: enc.noncePrefix,
        encSegmentSize: enc.segmentSize,
      })
      .returning({ id: transferFiles.id })
      .get();
    return { dir, dbPath, oldKey, env, storagePath, fileId: file.id };
  } finally {
    handle.sqlite.close();
  }
}

const quiet = () => {
  const lines: string[] = [];
  return { io: { log: (m: string) => lines.push(m) }, lines };
};

async function readBack(f: Fixture, newKey: Buffer) {
  const handle = openDatabase(f.dbPath);
  try {
    const user = handle.db.select().from(users).get()!;
    const file = handle.db.select().from(transferFiles).get()!;
    const chunks: Buffer[] = [];
    for await (const chunk of createDecryptStream({
      path: f.storagePath,
      size: PLAINTEXT.length,
      noncePrefix: file.encNoncePrefix,
      wrappedKey: file.encKeyWrapped,
      fileKey: deriveKey(newKey, 'file'),
    })) {
      chunks.push(chunk as Buffer);
    }
    const repo = createSettingsRepo({
      db: handle.db,
      keys: { smtp: deriveKey(newKey, 'smtp'), totp: deriveKey(newKey, 'totp') },
      clock: () => Date.now(),
    });
    return {
      plaintext: Buffer.concat(chunks).toString(),
      totp: decryptSecret(deriveKey(newKey, 'totp'), 'totp', user.totpSecretEnc!),
      smtp: repo.get('smtp'),
      pendingAdmin: repo.get('setup_admin_pending'),
      audits: handle.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'system.key_rotated'))
        .all(),
    };
  } finally {
    handle.sqlite.close();
  }
}

const keyIn = (file: string) => parseKey(readFileSync(file, 'utf8'), 'test');

describe('rotate-key CLI', () => {
  it('re-encrypts everything and replaces app.key, keeping the old one as app.key.previous', async () => {
    const f = await fixture();
    const { io, lines } = quiet();
    const result = await runRotateKey({ argv: [], env: f.env, io });

    expect(result?.files).toEqual({ rotated: 1, alreadyRotated: 0 });
    expect(result?.totpSecrets).toEqual({ rotated: 1, alreadyRotated: 0 });
    expect(result?.settings).toEqual({ rotated: 2, alreadyRotated: 0 });

    const secrets = path.join(f.dir, 'secrets');
    const newKey = keyIn(path.join(secrets, 'app.key'));
    expect(newKey.equals(f.oldKey)).toBe(false);
    expect(keyIn(path.join(secrets, 'app.key.previous')).equals(f.oldKey)).toBe(true);
    expect(existsSync(path.join(secrets, 'app.key.new'))).toBe(false);

    const back = await readBack(f, newKey);
    expect(back.plaintext).toBe(PLAINTEXT);
    expect(back.totp).toBe('JBSWY3DPEHPK3PXP');
    expect(back.smtp?.password).toBe(SMTP.password);
    expect(back.pendingAdmin).toEqual(PENDING_ADMIN);
    expect(back.audits).toHaveLength(1);

    expect(result?.backupPath && existsSync(result.backupPath)).toBe(true);
    expect(
      readdirSync(path.join(f.dir, 'db', 'backups')).some((n) => n.startsWith('pre-key-rotation-')),
    ).toBe(true);
    // The new key is never printed.
    expect(lines.join('\n')).not.toContain(newKey.toString('hex'));
    expect(lines.join('\n')).not.toContain(f.oldKey.toString('hex'));
  });

  it('is idempotent: a rerun with the same new key skips everything', async () => {
    const f = await fixture();
    const keyFile = path.join(f.dir, 'new.key');
    const newKey = randomBytes(32);
    writeFileSync(keyFile, newKey.toString('base64'));
    await runRotateKey({ argv: ['--new-key-file', keyFile], env: f.env, io: quiet().io });
    expect(keyIn(path.join(f.dir, 'secrets', 'app.key')).equals(newKey)).toBe(true);

    const again = await runRotateKey({
      argv: ['--new-key-file', keyFile],
      env: f.env,
      io: quiet().io,
    });
    expect(again?.files).toEqual({ rotated: 0, alreadyRotated: 1 });
    expect(again?.totpSecrets).toEqual({ rotated: 0, alreadyRotated: 1 });
    expect(again?.settings).toEqual({ rotated: 0, alreadyRotated: 2 });
    expect((await readBack(f, newKey)).plaintext).toBe(PLAINTEXT);
  });

  it('aborts and changes nothing when a value opens with neither key', async () => {
    const f = await fixture({ foreignTotp: true });
    const before = openDatabase(f.dbPath);
    const snapshot = {
      file: before.db.select().from(transferFiles).get()!.encKeyWrapped,
      settings: before.db.select().from(settings).all(),
    };
    before.sqlite.close();

    await expect(runRotateKey({ argv: [], env: f.env, io: quiet().io })).rejects.toThrow(
      RotateKeyError,
    );
    const secrets = path.join(f.dir, 'secrets');
    expect(keyIn(path.join(secrets, 'app.key')).equals(f.oldKey)).toBe(true);
    expect(existsSync(path.join(secrets, 'app.key.new'))).toBe(false);
    expect(existsSync(path.join(secrets, 'app.key.previous'))).toBe(false);

    const after = openDatabase(f.dbPath);
    expect(after.db.select().from(transferFiles).get()!.encKeyWrapped).toBe(snapshot.file);
    expect(after.db.select().from(settings).all()).toEqual(snapshot.settings);
    expect(after.db.select().from(auditLog).all()).toHaveLength(0);
    after.sqlite.close();
  });

  it('with the key in APP_SECRET_KEY writes app.key.new and leaves app.key alone', async () => {
    const f = await fixture({ envKey: true });
    const { io, lines } = quiet();
    const result = await runRotateKey({ argv: [], env: f.env, io });
    expect(result?.keySource).toBe('env');

    const secrets = path.join(f.dir, 'secrets');
    expect(existsSync(path.join(secrets, 'app.key'))).toBe(false);
    expect(existsSync(path.join(secrets, 'app.key.previous'))).toBe(false);
    const newKey = keyIn(path.join(secrets, 'app.key.new'));
    expect((await readBack(f, newKey)).smtp?.password).toBe(SMTP.password);
    expect(lines.join('\n')).toContain('APP_SECRET_KEY');
    expect(lines.join('\n')).not.toContain(newKey.toString('hex'));
  });

  it('refuses to overwrite a leftover app.key.new and rejects bad input', async () => {
    const f = await fixture();
    const secrets = path.join(f.dir, 'secrets');
    writeFileSync(path.join(secrets, 'app.key.new'), `${randomBytes(32).toString('hex')}\n`);
    await expect(runRotateKey({ argv: [], env: f.env, io: quiet().io })).rejects.toThrow(
      /already exists/,
    );

    const bad = path.join(f.dir, 'bad.key');
    writeFileSync(bad, 'not a key');
    await expect(
      runRotateKey({ argv: ['--new-key-file', bad], env: f.env, io: quiet().io }),
    ).rejects.toThrow(RotateKeyError);
    await expect(runRotateKey({ argv: ['--nope'], env: f.env, io: quiet().io })).rejects.toThrow(
      RotateKeyError,
    );
  });
});
