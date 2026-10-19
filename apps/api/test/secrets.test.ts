import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSecrets, SecretError } from '../src/secrets.js';
import { makeTempDir } from './helpers.js';

describe('resolveSecrets', () => {
  it('generates both keys once and reuses them', () => {
    const dir = path.join(makeTempDir(), 'secrets');
    const first = resolveSecrets(dir, {});
    const second = resolveSecrets(dir, {});

    expect(first.appSecretKey).toHaveLength(32);
    expect(first.sessionSecret).toHaveLength(32);
    expect(first.appSecretKey.equals(first.sessionSecret)).toBe(false);
    expect(second.appSecretKey.equals(first.appSecretKey)).toBe(true);
    expect(second.sessionSecret.equals(first.sessionSecret)).toBe(true);
    expect(readFileSync(path.join(dir, 'app.key'), 'utf8').trim()).toBe(
      first.appSecretKey.toString('hex'),
    );
  });

  it.skipIf(process.platform === 'win32')('writes key files with mode 600', () => {
    const dir = path.join(makeTempDir(), 'secrets');
    resolveSecrets(dir, {});
    expect(statSync(path.join(dir, 'app.key')).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('prefers the environment and does not write a file for it', () => {
    const dir = path.join(makeTempDir(), 'secrets');
    const hex = randomBytes(32).toString('hex');
    const base64 = randomBytes(32).toString('base64');
    const secrets = resolveSecrets(dir, { APP_SECRET_KEY: hex, SESSION_SECRET: base64 });

    expect(secrets.appSecretKey.toString('hex')).toBe(hex);
    expect(secrets.sessionSecret.toString('base64')).toBe(base64);
    expect(existsSync(path.join(dir, 'app.key'))).toBe(false);
    expect(existsSync(path.join(dir, 'session.key'))).toBe(false);
  });

  it('prefers the environment over an existing file', () => {
    const dir = path.join(makeTempDir(), 'secrets');
    resolveSecrets(dir, {});
    const hex = randomBytes(32).toString('hex');
    expect(resolveSecrets(dir, { APP_SECRET_KEY: hex }).appSecretKey.toString('hex')).toBe(hex);
  });

  it('rejects keys of the wrong length without echoing them', () => {
    const dir = path.join(makeTempDir(), 'secrets');
    const bad = 'deadbeef'.repeat(4);
    let message = '';
    try {
      resolveSecrets(dir, { APP_SECRET_KEY: bad });
    } catch (error) {
      expect(error).toBeInstanceOf(SecretError);
      message = (error as Error).message;
    }
    expect(message).toContain('APP_SECRET_KEY');
    expect(message).not.toContain(bad);
  });

  it('rejects a key file of the wrong length', () => {
    const dir = path.join(makeTempDir(), 'secrets');
    resolveSecrets(dir, {});
    writeFileSync(path.join(dir, 'session.key'), 'too-short\n');
    expect(() => resolveSecrets(dir, {})).toThrow(SecretError);
  });
});
