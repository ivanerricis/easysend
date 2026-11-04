import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.js';
import { settings } from '../src/db/schema/index.js';
import { importStorageEnv, readStorageEnv, storageEnvDiffers } from '../src/storage/env.js';
import { createTestApp, testConfig } from './helpers.js';

const S3_ENV = {
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'https://acc.r2.example.com/',
  S3_REGION: 'auto',
  S3_BUCKET: 'easysend',
  S3_PREFIX: 'prod',
  S3_FORCE_PATH_STYLE: 'true',
  S3_ACCESS_KEY_ID: 'AKIAENV',
  S3_SECRET_ACCESS_KEY: 'env-secret-key',
} as const;

const configFor = (env: Record<string, string>) => testConfig(env);

async function appWith(env: Record<string, string> = {}) {
  const t = await createTestApp({ env });
  return { t, deps: { config: t.config, settings: t.ctx.settings } };
}

describe('readStorageEnv', () => {
  it('is local when the driver is empty or local', () => {
    expect(readStorageEnv(configFor({}), {})).toEqual({ driver: 'local', source: 'env' });
    expect(readStorageEnv(configFor({ STORAGE_DRIVER: 'LOCAL' }), {}).driver).toBe('local');
    // S3 variables without STORAGE_DRIVER=s3 are ignored.
    expect(readStorageEnv(configFor({ S3_BUCKET: 'x' }), {}).driver).toBe('local');
  });

  it('reads and normalises a full S3 configuration', () => {
    const setting = readStorageEnv(configFor(S3_ENV), S3_ENV);
    expect(setting).toEqual({
      driver: 's3',
      source: 'env',
      s3: {
        endpoint: 'https://acc.r2.example.com',
        region: 'auto',
        bucket: 'easysend',
        prefix: 'prod',
        forcePathStyle: true,
        accessKeyId: 'AKIAENV',
        secretAccessKey: 'env-secret-key',
      },
    });
  });

  it('defaults prefix and path style, and reads the secret from a file in secrets/', () => {
    const { S3_PREFIX: _p, S3_FORCE_PATH_STYLE: _f, S3_SECRET_ACCESS_KEY: _s, ...rest } = S3_ENV;
    const config = configFor({ ...rest, S3_SECRET_ACCESS_KEY_FILE: 's3.secret' });
    mkdirSync(config.secretsDir, { recursive: true });
    const file = path.join(config.secretsDir, 's3.secret');
    writeFileSync(file, '  file-secret\n');
    // A relative name resolves against the secrets directory.
    expect(readStorageEnv(config, {}).s3).toMatchObject({
      prefix: '',
      forcePathStyle: false,
      secretAccessKey: 'file-secret',
    });
    // An absolute path is used as it is.
    const absolute = configFor({ ...rest, S3_SECRET_ACCESS_KEY_FILE: file });
    expect(readStorageEnv(absolute, {}).s3?.secretAccessKey).toBe('file-secret');
  });

  it('fails naming the variables, never their values', () => {
    const bad = { ...S3_ENV, S3_ENDPOINT: 'not a url', S3_BUCKET: 'X', S3_ACCESS_KEY_ID: '' };
    try {
      readStorageEnv(configFor(bad), bad);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as Error).message;
      expect(message).toContain('S3_ENDPOINT');
      expect(message).toContain('S3_BUCKET');
      expect(message).toContain('S3_ACCESS_KEY_ID');
      expect(message).not.toContain('env-secret-key');
      expect(message).not.toContain('not a url');
    }
    expect(() => readStorageEnv(configFor({ ...S3_ENV, STORAGE_DRIVER: 'ftp' }), S3_ENV)).toThrow(
      /STORAGE_DRIVER/,
    );
    const noSecret = { ...S3_ENV, S3_SECRET_ACCESS_KEY: '' };
    expect(() => readStorageEnv(configFor(noSecret), noSecret)).toThrow(/S3_SECRET_ACCESS_KEY/);
    expect(() =>
      readStorageEnv(configFor({ ...S3_ENV, S3_FORCE_PATH_STYLE: 'maybe' }), S3_ENV),
    ).toThrow(/S3_FORCE_PATH_STYLE/);
    expect(() =>
      readStorageEnv(
        configFor({
          ...S3_ENV,
          S3_SECRET_ACCESS_KEY: '',
          S3_SECRET_ACCESS_KEY_FILE: 'missing.key',
        }),
        { ...S3_ENV, S3_SECRET_ACCESS_KEY: '' },
      ),
    ).toThrow(/S3_SECRET_ACCESS_KEY_FILE/);
  });
});

describe('importStorageEnv (first start only)', () => {
  it('seeds local when the environment is empty', async () => {
    const { t, deps } = await appWith();
    expect(importStorageEnv(deps, {})).toBe('imported');
    expect(t.ctx.settings.get('storage')).toEqual({ driver: 'local', source: 'env' });
  });

  it('imports the S3 configuration encrypted, with source env', async () => {
    const { t, deps } = await appWith(S3_ENV);
    expect(importStorageEnv(deps, S3_ENV)).toBe('imported');
    expect(t.ctx.settings.get('storage')).toMatchObject({
      driver: 's3',
      source: 'env',
      s3: { bucket: 'easysend', secretAccessKey: 'env-secret-key' },
    });
    const row = t.db.db.select().from(settings).where(eq(settings.key, 'storage')).get()!;
    expect(row.isEncrypted).toBe(true);
    const raw = JSON.stringify(row.value);
    expect(raw).not.toContain('env-secret-key');
    expect(raw).not.toContain('acc.r2.example.com');
    expect(raw).not.toContain('easysend');
  });

  it('never overwrites an existing setting, and ignores an invalid environment then', async () => {
    const { t, deps } = await appWith(S3_ENV);
    t.ctx.settings.set('storage', { driver: 'local', source: 'panel' });
    expect(importStorageEnv(deps, S3_ENV)).toBe('skipped');
    expect(t.ctx.settings.get('storage')).toEqual({ driver: 'local', source: 'panel' });

    const bad = await appWith({ STORAGE_DRIVER: 'nonsense' });
    bad.t.ctx.settings.set('storage', { driver: 'local', source: 'env' });
    expect(importStorageEnv(bad.deps, {})).toBe('skipped');
  });

  it('fails the start for an invalid S3 environment and writes nothing', async () => {
    const env = { ...S3_ENV, S3_BUCKET: '' };
    const { t, deps } = await appWith(env);
    expect(() => importStorageEnv(deps, env)).toThrow(ConfigError);
    expect(t.ctx.settings.has('storage')).toBe(false);
  });
});

describe('storageEnvDiffers', () => {
  it('is false without a stored setting', async () => {
    const { deps } = await appWith(S3_ENV);
    expect(storageEnvDiffers(deps, S3_ENV)).toBe(false);
  });

  it('is false right after the import and true once the panel changes the configuration', async () => {
    const { t, deps } = await appWith(S3_ENV);
    importStorageEnv(deps, S3_ENV);
    expect(storageEnvDiffers(deps, S3_ENV)).toBe(false);

    const active = t.ctx.settings.get('storage')!;
    t.ctx.settings.set('storage', {
      ...active,
      source: 'panel',
      s3: { ...active.s3!, secretAccessKey: 'rotated-key' },
    });
    expect(storageEnvDiffers(deps, S3_ENV)).toBe(true);
  });

  it('compares the active driver only: local with a remembered S3 config equals an empty env', async () => {
    const { t, deps } = await appWith();
    importStorageEnv(deps, {});
    t.ctx.settings.set('storage', {
      driver: 'local',
      source: 'panel',
      s3: {
        endpoint: 'https://s3.example.test',
        region: 'auto',
        bucket: 'abc',
        prefix: '',
        forcePathStyle: false,
        accessKeyId: 'a',
        secretAccessKey: 'b',
      },
    });
    expect(storageEnvDiffers(deps, {})).toBe(false);
    const withS3Env = { config: configFor(S3_ENV), settings: t.ctx.settings };
    expect(storageEnvDiffers(withS3Env, S3_ENV)).toBe(true);
  });

  it('counts an unparseable environment as different', async () => {
    const { t, deps } = await appWith({ STORAGE_DRIVER: 'ftp' });
    t.ctx.settings.set('storage', { driver: 'local', source: 'panel' });
    expect(storageEnvDiffers(deps, {})).toBe(true);
  });
});
