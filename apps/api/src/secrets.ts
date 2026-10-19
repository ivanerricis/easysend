import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const KEY_BYTES = 32;

export interface Secrets {
  appSecretKey: Buffer;
  sessionSecret: Buffer;
}

/** Thrown when a secret is malformed. Never includes the secret value. */
export class SecretError extends Error {
  constructor(source: string) {
    super(`Invalid secret from ${source}: expected 64 hex characters or base64 of 32 bytes`);
    this.name = 'SecretError';
  }
}

/** Accepts 64 hex characters or base64 (standard or url-safe) encoding of exactly 32 bytes. */
export function parseKey(raw: string, source: string): Buffer {
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    const buffer = Buffer.from(value, 'base64');
    if (buffer.length === KEY_BYTES) return buffer;
  }
  throw new SecretError(source);
}

function readKeyFile(file: string): Buffer | undefined {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  return parseKey(content, `file ${path.basename(file)}`);
}

function resolveSecret(envValue: string | undefined, envName: string, file: string): Buffer {
  if (envValue !== undefined && envValue.trim() !== '') return parseKey(envValue, envName);

  const existing = readKeyFile(file);
  if (existing) return existing;

  const key = randomBytes(KEY_BYTES);
  try {
    // Flag 'wx' fails if another process created the file in the meantime.
    writeFileSync(file, `${key.toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const raced = readKeyFile(file);
    if (!raced) throw error;
    return raced;
  }
}

/** Key files must not be readable by group or others. POSIX only: Windows has no mode bits. */
function assertPrivateFile(file: string): void {
  if (process.platform === 'win32') return;
  let mode: number;
  try {
    mode = statSync(file).mode;
  } catch {
    return; // The key came from the environment, there is no file to check.
  }
  if ((mode & 0o077) !== 0) {
    throw new Error(`Secret file ${path.basename(file)} must not be accessible by group or others`);
  }
}

/** Resolution order: environment, then `<secretsDir>/*.key`, then generate and persist. */
export function resolveSecrets(
  secretsDir: string,
  env: Record<string, string | undefined>,
): Secrets {
  mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  const appFile = path.join(secretsDir, 'app.key');
  const sessionFile = path.join(secretsDir, 'session.key');
  const secrets = {
    appSecretKey: resolveSecret(env['APP_SECRET_KEY'], 'APP_SECRET_KEY', appFile),
    sessionSecret: resolveSecret(env['SESSION_SECRET'], 'SESSION_SECRET', sessionFile),
  };
  assertPrivateFile(appFile);
  assertPrivateFile(sessionFile);
  return secrets;
}
