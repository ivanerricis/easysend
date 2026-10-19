import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { eq, isNotNull } from 'drizzle-orm';
import { audit } from '../audit.js';
import { systemClock, nowSeconds } from '../clock.js';
import { ConfigError, loadConfig } from '../config.js';
import { decryptSecret, encryptSecret } from '../crypto/aead.js';
import {
  APP_KEY_PURPOSES,
  deriveKey,
  type AppKeyPurpose,
  type KeyPurpose,
} from '../crypto/keys.js';
import { unwrapDataKey, wrapDataKey } from '../crypto/segments.js';
import { openDatabase, type Db } from '../db/client.js';
import { settings, transferFiles, users } from '../db/schema/index.js';
import { parseKey, SecretError } from '../secrets.js';
import { ENCRYPTED_KEYS, type SettingKey } from '../settings/repo.js';

export class RotateKeyError extends Error {}

export interface RotateKeyIo {
  log(message: string): void;
}

export interface RotateCounts {
  rotated: number;
  /** Already encrypted with the new key (a previous run was interrupted or repeated). */
  alreadyRotated: number;
}

export interface RotateKeyResult {
  files: RotateCounts;
  totpSecrets: RotateCounts;
  settings: RotateCounts;
  backupPath: string;
  /** `file`: `app.key` was replaced. `env`: the new key is in `app.key.new`, APP_SECRET_KEY is yours to change. */
  keySource: 'file' | 'env';
  newKeyFile: string;
}

const BACKUP_FILE = /^pre-key-rotation-.+\.sqlite$/;
const BACKUPS_TO_KEEP = 5;

export const ROTATE_KEY_USAGE = `Usage: key:rotate [--new-key-file <path>]

Re-encrypts the per-file data keys, TOTP secrets and SMTP password with a new master key
(APP_SECRET_KEY). Encrypted files on disk are not touched.
STOP THE API FIRST (the database must not be written while the keys change).
Without --new-key-file a random key is generated.`;

type Purpose = Extract<KeyPurpose, AppKeyPurpose>;

/** Outcome of trying to open a value: rotated to the new key, already on it, or unreadable. */
function reencrypt(
  value: string,
  purpose: Purpose,
  oldKey: Buffer,
  newKey: Buffer,
): { value: string; rotated: boolean } | undefined {
  try {
    decryptSecret(newKey, purpose, value);
    return { value, rotated: false };
  } catch {
    // Not on the new key yet.
  }
  try {
    const plain = decryptSecret(oldKey, purpose, value);
    return { value: encryptSecret(newKey, purpose, plain), rotated: true };
  } catch {
    return undefined;
  }
}

function emptyCounts(): RotateCounts {
  return { rotated: 0, alreadyRotated: 0 };
}

const count = (counts: RotateCounts, rotated: boolean) => {
  if (rotated) counts.rotated += 1;
  else counts.alreadyRotated += 1;
};

/**
 * Re-encrypts every value protected by a key derived from the master key, in ONE transaction:
 * the wrapped data keys of the files, the TOTP secrets and the encrypted settings. A value that
 * opens with neither key aborts the transaction (nothing changes). `beforeCommit` runs last
 * inside the transaction: a failure there also rolls everything back.
 */
export function rotateDatabaseKeys(
  db: Db,
  oldMaster: Buffer,
  newMaster: Buffer,
  beforeCommit?: (counts: Omit<RotateKeyResult, 'backupPath' | 'keySource' | 'newKeyFile'>) => void,
): Omit<RotateKeyResult, 'backupPath' | 'keySource' | 'newKeyFile'> {
  const derive = (master: Buffer) =>
    Object.fromEntries(APP_KEY_PURPOSES.map((p) => [p, deriveKey(master, p)])) as Record<
      Purpose,
      Buffer
    >;
  const oldKeys = derive(oldMaster);
  const newKeys = derive(newMaster);
  const result = { files: emptyCounts(), totpSecrets: emptyCounts(), settings: emptyCounts() };

  db.transaction((tx) => {
    for (const row of tx
      .select({ id: transferFiles.id, wrapped: transferFiles.encKeyWrapped })
      .from(transferFiles)
      .all()) {
      let next: { value: string; rotated: boolean } | undefined;
      try {
        unwrapDataKey(newKeys.file, row.wrapped);
        next = { value: row.wrapped, rotated: false };
      } catch {
        try {
          const dataKey = unwrapDataKey(oldKeys.file, row.wrapped);
          next = { value: wrapDataKey(newKeys.file, dataKey), rotated: true };
        } catch {
          next = undefined;
        }
      }
      if (!next) throw new RotateKeyError('A file key opens with neither the old nor the new key');
      if (next.rotated) {
        tx.update(transferFiles)
          .set({ encKeyWrapped: next.value })
          .where(eq(transferFiles.id, row.id))
          .run();
      }
      count(result.files, next.rotated);
    }

    for (const row of tx
      .select({ id: users.id, secret: users.totpSecretEnc })
      .from(users)
      .where(isNotNull(users.totpSecretEnc))
      .all()) {
      const next = reencrypt(row.secret!, 'totp', oldKeys.totp, newKeys.totp);
      if (!next)
        throw new RotateKeyError('A TOTP secret opens with neither the old nor the new key');
      if (next.rotated) {
        tx.update(users).set({ totpSecretEnc: next.value }).where(eq(users.id, row.id)).run();
      }
      count(result.totpSecrets, next.rotated);
    }

    for (const row of tx.select().from(settings).where(eq(settings.isEncrypted, true)).all()) {
      const purpose = ENCRYPTED_KEYS[row.key as SettingKey];
      if (!purpose || !(APP_KEY_PURPOSES as readonly string[]).includes(purpose)) {
        throw new RotateKeyError('An encrypted setting has no known key purpose');
      }
      if (typeof row.value !== 'string') {
        throw new RotateKeyError('An encrypted setting has an unexpected format');
      }
      const next = reencrypt(
        row.value,
        purpose as Purpose,
        oldKeys[purpose as Purpose],
        newKeys[purpose as Purpose],
      );
      if (!next) throw new RotateKeyError('A setting opens with neither the old nor the new key');
      if (next.rotated) {
        tx.update(settings)
          .set({ value: next.value, updatedAt: nowSeconds(systemClock) })
          .where(eq(settings.key, row.key))
          .run();
      }
      count(result.settings, next.rotated);
    }

    audit(tx, {
      actorId: null,
      action: 'system.key_rotated',
      metadata: {
        files: result.files,
        totpSecrets: result.totpSecrets,
        settings: result.settings,
      },
      now: nowSeconds(systemClock),
    });
    beforeCommit?.(result);
  });
  return result;
}

const timestamp = (): string => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');

function pruneBackups(backupDir: string): void {
  const files = readdirSync(backupDir)
    .filter((name) => BACKUP_FILE.test(name))
    .map((name) => ({ name, mtime: statSync(path.join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  for (const old of files.slice(BACKUPS_TO_KEEP)) unlinkSync(path.join(backupDir, old.name));
}

/** Writes a key as hex, readable by the owner only, and flushes it to disk. */
function writeKeyFile(file: string, key: Buffer): void {
  writeFileSync(file, `${key.toString('hex')}\n`, { mode: 0o600 });
  const fd = openSync(file, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readKeyFile(file: string, source: string): Buffer | undefined {
  try {
    return parseKey(readFileSync(file, 'utf8'), source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof SecretError) throw new RotateKeyError(error.message);
    throw error;
  }
}

export interface RotateKeyOptions {
  argv: string[];
  env: NodeJS.ProcessEnv;
  io?: RotateKeyIo;
}

/**
 * Master key rotation. Steps: online backup of the database, re-encryption in one transaction,
 * the new key written to `app.key.new` BEFORE the commit, then (key stored in `app.key`) the old
 * key saved to `app.key.previous` and `app.key.new` renamed over `app.key` (one atomic step, so
 * there is never a moment without a key file). If the key comes from APP_SECRET_KEY the
 * new key stays in `app.key.new` for the operator to put in the environment. Keys are never
 * printed. Rerunning with `--new-key-file` and the same key skips values already rotated, so an
 * interrupted run can be resumed.
 */
export async function runRotateKey(
  options: RotateKeyOptions,
): Promise<RotateKeyResult | undefined> {
  const io: RotateKeyIo = options.io ?? { log: (message) => console.log(message) };

  let values: { 'new-key-file'?: string | undefined; help?: boolean | undefined };
  try {
    ({ values } = parseArgs({
      args: options.argv.filter((arg) => arg !== '--'),
      options: { 'new-key-file': { type: 'string' }, help: { type: 'boolean' } },
      strict: true,
    }));
  } catch (error) {
    throw new RotateKeyError(`${(error as Error).message}\n${ROTATE_KEY_USAGE}`);
  }
  if (values.help) {
    io.log(ROTATE_KEY_USAGE);
    return undefined;
  }

  const config = loadConfig(options.env);
  const keyFile = path.join(config.secretsDir, 'app.key');
  const newFile = `${keyFile}.new`;
  const previousFile = `${keyFile}.previous`;

  const envKey = options.env['APP_SECRET_KEY'];
  const fromEnv = envKey !== undefined && envKey.trim() !== '';
  let oldKey: Buffer;
  try {
    oldKey = fromEnv
      ? parseKey(envKey, 'APP_SECRET_KEY')
      : (readKeyFile(keyFile, 'app.key') as Buffer);
  } catch (error) {
    if (error instanceof SecretError) throw new RotateKeyError(error.message);
    throw error;
  }
  if (!oldKey) throw new RotateKeyError('No current key found (APP_SECRET_KEY or secrets/app.key)');

  if (!existsSync(config.dbPath)) throw new RotateKeyError('Database not found');

  let newKey: Buffer;
  if (values['new-key-file']) {
    const provided = readKeyFile(values['new-key-file'], '--new-key-file');
    if (!provided) throw new RotateKeyError('The file given to --new-key-file does not exist');
    newKey = provided;
  } else {
    // A leftover app.key.new may be the only copy of a key already used by the database.
    if (existsSync(newFile)) {
      throw new RotateKeyError(
        `${path.basename(newFile)} already exists (a previous run was interrupted?). ` +
          `Check it, then resume with --new-key-file <that file> or delete it.`,
      );
    }
    newKey = randomBytes(32);
  }
  const resumingFromNewFile = path.resolve(values['new-key-file'] ?? '') === path.resolve(newFile);
  if (!resumingFromNewFile && existsSync(newFile)) {
    const leftover = readKeyFile(newFile, 'app.key.new');
    if (!leftover?.equals(newKey)) {
      throw new RotateKeyError(
        `${path.basename(newFile)} holds a different key: resolve it before rotating`,
      );
    }
  }

  const handle = openDatabase(config.dbPath);
  try {
    mkdirSync(config.dbBackupDir, { recursive: true });
    const backupPath = path.join(config.dbBackupDir, `pre-key-rotation-${timestamp()}.sqlite`);
    await handle.sqlite.backup(backupPath);
    pruneBackups(config.dbBackupDir);

    mkdirSync(config.secretsDir, { recursive: true, mode: 0o700 });
    let wroteNewFile = false;
    let counts: ReturnType<typeof rotateDatabaseKeys>;
    try {
      counts = rotateDatabaseKeys(handle.db, oldKey, newKey, () => {
        // Last thing before the commit: if the key cannot be saved, nothing is rotated.
        if (resumingFromNewFile) return;
        writeKeyFile(newFile, newKey);
        wroteNewFile = true;
      });
    } catch (error) {
      // Nothing was committed: the key written for it must not be mistaken for a live one.
      if (wroteNewFile) rmSync(newFile, { force: true });
      throw error;
    }

    if (!fromEnv) {
      writeKeyFile(previousFile, oldKey);
      renameSync(newFile, keyFile);
    }

    const result: RotateKeyResult = {
      ...counts,
      backupPath,
      keySource: fromEnv ? 'env' : 'file',
      newKeyFile: fromEnv ? newFile : keyFile,
    };
    reportResult(io, result);
    return result;
  } finally {
    handle.sqlite.close();
  }
}

function reportResult(io: RotateKeyIo, r: RotateKeyResult): void {
  const line = (label: string, c: RotateCounts) =>
    io.log(`  ${label}: ${c.rotated} rotated, ${c.alreadyRotated} already on the new key`);
  io.log('Master key rotated.');
  line('file keys', r.files);
  line('TOTP secrets', r.totpSecrets);
  line('settings', r.settings);
  io.log(`Database backup: ${r.backupPath}`);
  if (r.keySource === 'file') {
    io.log('The new key is now in secrets/app.key; the old one is in secrets/app.key.previous.');
    io.log('Start the API again. Keep app.key.previous until you have verified everything works,');
    io.log('then delete it (it can decrypt anything made before the rotation).');
  } else {
    io.log(`The new key is in ${r.newKeyFile} (permissions 600). Next steps:`);
    io.log('  1. set APP_SECRET_KEY to the content of that file in your environment;');
    io.log('  2. start the API again;');
    io.log('  3. delete the file once the API runs with the new key.');
    io.log('Until step 1 the API will not be able to read what was just re-encrypted.');
  }
}

// Entry point: skipped when the module is imported (tests call runRotateKey directly).
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await runRotateKey({ argv: process.argv.slice(2), env: process.env });
  } catch (error) {
    console.error(
      error instanceof RotateKeyError || error instanceof ConfigError
        ? error.message
        : 'key:rotate failed unexpectedly',
    );
    process.exitCode = 1;
  }
}
