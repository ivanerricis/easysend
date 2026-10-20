import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies SPEC defaults and derives paths from DATA_DIR', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      mode: 'production',
      port: 3000,
      logLevel: 'info',
      timezone: 'Europe/Rome',
      trustProxy: 2,
      logRetentionDays: 90,
      incompleteUploadTtlHours: 24,
      cleanupCron: '0 * * * *',
      defaultDiskReserveMb: 1024,
      defaultChunkSizeMb: 25,
      publicUrl: undefined,
      version: '0.0.0-dev',
    });
    expect(config.dbPath).toBe(path.join('/data', 'db', 'app.sqlite'));
    expect(config.storageDir).toBe(path.join('/data', 'storage'));
    expect(config.tmpUploadDir).toBe(path.join('/data', 'tmp'));
    expect(config.brandingDir).toBe(path.join('/data', 'branding'));
    expect(config.secretsDir).toBe(path.join('/data', 'secrets'));
  });

  it('follows a custom DATA_DIR and explicit overrides', () => {
    const config = loadConfig({ DATA_DIR: '/srv/x', STORAGE_DIR: '/mnt/files' });
    expect(config.dbPath).toBe(path.join('/srv/x', 'db', 'app.sqlite'));
    expect(config.dbBackupDir).toBe(path.join('/srv/x', 'db', 'backups'));
    expect(config.storageDir).toBe('/mnt/files');
  });

  it('uses the Cloudflare API by default and normalizes CLOUDFLARE_API_BASE', () => {
    expect(loadConfig({}).cloudflareApiBase).toBe('https://api.cloudflare.com/client/v4');
    expect(
      loadConfig({ CLOUDFLARE_API_BASE: 'http://fake-cloudflare:8787/client/v4/' })
        .cloudflareApiBase,
    ).toBe('http://fake-cloudflare:8787/client/v4');
    expect(() => loadConfig({ CLOUDFLARE_API_BASE: 'not a url' })).toThrow(ConfigError);
  });

  it('uses the GitHub releases API for the update check unless UPDATE_CHECK_URL is set', () => {
    expect(loadConfig({}).updateCheckUrl).toBe(
      'https://api.github.com/repos/ivanerricis/easysend/releases/latest',
    );
    expect(
      loadConfig({ UPDATE_CHECK_URL: 'https://mirror.example.org/x.json' }).updateCheckUrl,
    ).toBe('https://mirror.example.org/x.json');
    expect(() => loadConfig({ UPDATE_CHECK_URL: 'nope' })).toThrow(ConfigError);
  });

  it('defaults PUBLIC_URL and TRUST_PROXY in local mode', () => {
    const config = loadConfig({ APP_MODE: 'local' });
    expect(config.publicUrl).toBe('http://localhost:8080');
    expect(config.trustProxy).toBe(1);
  });

  it('keeps an explicit PUBLIC_URL and TRUST_PROXY', () => {
    const config = loadConfig({
      APP_MODE: 'local',
      PUBLIC_URL: 'http://127.0.0.1:9000',
      TRUST_PROXY: '0',
    });
    expect(config.publicUrl).toBe('http://127.0.0.1:9000');
    expect(config.trustProxy).toBe(0);
  });

  it('treats empty strings as unset and coerces numbers and booleans', () => {
    const config = loadConfig({ PORT: '', LOG_RETENTION_DAYS: '30', LOG_PRETTY: 'true' });
    expect(config.port).toBe(3000);
    expect(config.logRetentionDays).toBe(30);
    expect(config.logPretty).toBe(true);
  });

  it('accepts APP_VERSION', () => {
    expect(loadConfig({ APP_VERSION: '1.2.3' }).version).toBe('1.2.3');
  });

  it.each([
    ['APP_MODE', 'staging'],
    ['PORT', 'abc'],
    ['PORT', '70000'],
    ['DEFAULT_CHUNK_SIZE_MB', '0'],
    ['DEFAULT_CHUNK_SIZE_MB', '51'],
    ['TRUST_PROXY', '-1'],
    ['TRUST_PROXY', '1.5'],
    ['PUBLIC_URL', 'not a url'],
    ['LOG_LEVEL', 'loud'],
  ])('rejects invalid %s=%s', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(ConfigError);
  });

  it('accepts chunk size bounds 1 and 50', () => {
    expect(loadConfig({ DEFAULT_CHUNK_SIZE_MB: '1' }).defaultChunkSizeMb).toBe(1);
    expect(loadConfig({ DEFAULT_CHUNK_SIZE_MB: '50' }).defaultChunkSizeMb).toBe(50);
  });

  it('lists variable names and never values in errors', () => {
    let message = '';
    let variables: string[] = [];
    try {
      loadConfig({ PORT: 'super-secret-value', TRUST_PROXY: 'another-secret' });
    } catch (error) {
      message = (error as Error).message;
      variables = (error as ConfigError).variables;
    }
    expect(variables).toEqual(['PORT', 'TRUST_PROXY']);
    expect(message).toContain('PORT');
    expect(message).not.toContain('super-secret-value');
    expect(message).not.toContain('another-secret');
  });
});
