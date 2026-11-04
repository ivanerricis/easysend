import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { S3Config, StorageSettingsResponse } from '@easysend/shared';
import { csrfClient } from './auth-flow.js';
import { auditLog } from '../src/db/schema/index.js';
import { AppError } from '../src/http/errors.js';
import { STORAGE_VERIFICATION_TTL_MS } from '../src/storage/verification.js';
import { binaryRequest, createTransferFixture } from './transfer-fixtures.js';
import {
  bodyAs,
  createTestApp,
  errorCode,
  makeTempDir,
  type TestApp,
  type TestResponse,
} from './helpers.js';
import { loginAs } from './session-helpers.js';
import { createFakeS3App, TEST_S3_CONFIG } from './storage-helpers.js';

const SECRET = 'super-secret-access-key-value';
const S3_BODY = {
  endpoint: 'https://s3.example.test',
  region: 'auto',
  bucket: 'my-bucket',
  prefix: 'easysend',
  forcePathStyle: true,
  accessKeyId: 'AKIAEXAMPLE',
};

/** App whose probe records the configurations it was given and fails on demand. */
async function setup(options: { setupCompleted?: boolean; fakeS3?: boolean } = {}) {
  const probed: S3Config[] = [];
  const state: { fail: Error | undefined } = { fail: undefined };
  const overrides = {
    env: { DATA_DIR: makeTempDir() },
    ...(options.setupCompleted === undefined ? {} : { setupCompleted: options.setupCompleted }),
    deps: {
      storageProbe: (config: S3Config) => {
        probed.push(config);
        return state.fail ? Promise.reject(state.fail) : Promise.resolve();
      },
    },
  };
  const t = options.fakeS3
    ? (await createFakeS3App(overrides, { active: false })).t
    : await createTestApp(overrides);
  const admin = await t.createUser({ role: 'admin', totp: true });
  return { t, state, probed, admin, client: loginAs(t, admin) };
}

const view = (res: TestResponse) => bodyAs<StorageSettingsResponse>(res);
const auditActions = (t: TestApp) =>
  t.ctx.db
    .select({ action: auditLog.action })
    .from(auditLog)
    .all()
    .map((r) => r.action);

describe('GET /api/admin/settings/storage', () => {
  it('shows the local default with no files, nothing locked and no secret', async () => {
    const { client } = await setup();
    const res = await client.get('/api/admin/settings/storage');
    expect(res.status).toBe(200);
    expect(view(res)).toEqual({
      driver: 'local',
      s3: null,
      source: 'env',
      envDiffers: false,
      usage: { local: { files: 0, bytes: 0 }, s3: { files: 0, bytes: 0 } },
      locked: { fields: [], reason: null },
    });
  });

  it('reports a stored configuration without the secret, usage per driver and envDiffers', async () => {
    const { t, client } = await setup();
    t.ctx.settings.set('storage', { driver: 'local', s3: TEST_S3_CONFIG, source: 'env' });
    await createTransferFixture(t, { files: [{ name: 'a.bin', size: 100 }] });
    const res = await client.get('/api/admin/settings/storage');
    const body = view(res);
    expect(body.s3).toMatchObject({ bucket: TEST_S3_CONFIG.bucket, hasSecret: true });
    expect(JSON.stringify(res.body)).not.toContain(TEST_S3_CONFIG.secretAccessKey);
    expect(body.usage.local.files).toBe(1);
    expect(body.usage.s3.files).toBe(0);
    expect(body.locked.reason).toBeNull();
    // The environment has no S3 configuration while the stored one is "local with S3 kept".
    expect(body.envDiffers).toBe(false);
  });

  it('locks endpoint, bucket and prefix while files live on S3', async () => {
    const { t, fake } = await createFakeS3App();
    expect(fake).toBeDefined();
    const admin = await t.createUser({ role: 'admin' });
    await createTransferFixture(t, { storage: 's3', files: [{ name: 'a.bin', size: 10 }] });
    const res = await loginAs(t, admin).get('/api/admin/settings/storage');
    expect(view(res).locked).toEqual({
      fields: ['endpoint', 'bucket', 'prefix'],
      reason: 's3_has_files',
    });
    expect(view(res).usage.s3.files).toBe(1);
  });

  it('is admin only', async () => {
    const { t } = await setup();
    const user = await t.createUser();
    expect((await loginAs(t, user).get('/api/admin/settings/storage')).status).toBe(403);
    expect((await t.client().get('/api/admin/settings/storage')).status).toBe(401);
  });
});

describe('storage test and verified save', () => {
  it('refuses to save S3 without a successful test (STORAGE_NOT_VERIFIED)', async () => {
    const { t, client } = await setup();
    const res = await client.put('/api/admin/settings/storage', {
      body: { driver: 's3', s3: { ...S3_BODY, secretAccessKey: SECRET } },
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('STORAGE_NOT_VERIFIED');
    expect(t.ctx.settings.get('storage')).toBeUndefined();
  });

  it('reports a failed test as STORAGE_TEST_FAILED with a safe reason only', async () => {
    const { client, state } = await setup();
    state.fail = new AppError('STORAGE_UNAVAILABLE', `denied for ${SECRET}`, {
      reason: 'ACCESS_DENIED',
    });
    const res = await client.post('/api/admin/settings/storage/test', {
      body: { s3: { ...S3_BODY, secretAccessKey: SECRET } },
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('STORAGE_TEST_FAILED');
    expect(bodyAs<{ error: { details: unknown } }>(res).error.details).toEqual({
      reason: 'ACCESS_DENIED',
    });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);

    // Anything unexpected becomes the generic NETWORK reason.
    state.fail = new Error(`boom ${SECRET}`);
    const other = await client.post('/api/admin/settings/storage/test', {
      body: { s3: { ...S3_BODY, secretAccessKey: SECRET } },
    });
    expect(bodyAs<{ error: { details: unknown } }>(other).error.details).toEqual({
      reason: 'NETWORK',
    });
    expect(JSON.stringify(other.body)).not.toContain(SECRET);
  });

  it('needs a secret key when none is stored (VALIDATION_ERROR)', async () => {
    const { client, probed } = await setup();
    const res = await client.post('/api/admin/settings/storage/test', { body: { s3: S3_BODY } });
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
    expect(probed).toHaveLength(0);
  });

  it('saves after a matching test: encrypted, source panel, no secret in the response, audited', async () => {
    const { t, client, probed } = await setup();
    const s3 = { ...S3_BODY, secretAccessKey: SECRET };
    expect((await client.post('/api/admin/settings/storage/test', { body: { s3 } })).status).toBe(
      200,
    );
    expect(probed).toEqual([s3]);

    const res = await client.put('/api/admin/settings/storage', { body: { driver: 's3', s3 } });
    expect(res.status).toBe(200);
    expect(view(res)).toMatchObject({
      driver: 's3',
      source: 'panel',
      s3: { bucket: 'my-bucket', hasSecret: true },
    });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(t.ctx.settings.get('storage')).toEqual({ driver: 's3', s3, source: 'panel' });
    // Stored encrypted: the raw row never holds the secret in clear.
    const raw = t.db.sqlite.prepare("SELECT value FROM settings WHERE key = 'storage'").get() as {
      value: string;
    };
    expect(raw.value).not.toContain(SECRET);

    const row = t.ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'settings.storage_updated'))
      .get();
    expect(row?.metadata).toEqual({ driver: 's3', source: 'panel' });
    expect(JSON.stringify(row)).not.toContain(SECRET);

    // The verification is consumed: saving again needs a new test.
    const again = await client.put('/api/admin/settings/storage', { body: { driver: 's3', s3 } });
    expect(errorCode(again)).toBe('STORAGE_NOT_VERIFIED');
  });

  it('requires the test to match the saved settings exactly and to be fresh', async () => {
    const { t, client } = await setup();
    const s3 = { ...S3_BODY, secretAccessKey: SECRET };
    await client.post('/api/admin/settings/storage/test', { body: { s3 } });
    const changed = await client.put('/api/admin/settings/storage', {
      body: { driver: 's3', s3: { ...s3, bucket: 'other-bucket' } },
    });
    expect(errorCode(changed)).toBe('STORAGE_NOT_VERIFIED');

    t.clock.advance(STORAGE_VERIFICATION_TTL_MS / 1000 + 1);
    const stale = await client.put('/api/admin/settings/storage', { body: { driver: 's3', s3 } });
    expect(errorCode(stale)).toBe('STORAGE_NOT_VERIFIED');
  });

  it('uses the stored secret when it is omitted', async () => {
    const { t, client, probed } = await setup();
    t.ctx.settings.set('storage', { driver: 'local', s3: TEST_S3_CONFIG, source: 'env' });
    const { secretAccessKey: _omit, ...input } = TEST_S3_CONFIG;
    expect(
      (await client.post('/api/admin/settings/storage/test', { body: { s3: input } })).status,
    ).toBe(200);
    expect(probed[0]).toEqual(TEST_S3_CONFIG);
    const res = await client.put('/api/admin/settings/storage', {
      body: { driver: 's3', s3: input },
    });
    expect(res.status).toBe(200);
    expect(t.ctx.settings.get('storage')?.s3?.secretAccessKey).toBe(TEST_S3_CONFIG.secretAccessKey);
  });

  it('limits tests to 10 per hour', async () => {
    const { client } = await setup();
    const body = { s3: { ...S3_BODY, secretAccessKey: SECRET } };
    for (let i = 0; i < 10; i += 1) {
      expect((await client.post('/api/admin/settings/storage/test', { body })).status).toBe(200);
    }
    const res = await client.post('/api/admin/settings/storage/test', { body });
    expect(res.status).toBe(429);
  });

  it('switches back to local without a test and keeps the saved S3 configuration', async () => {
    const { t, client } = await setup();
    t.ctx.settings.set('storage', { driver: 's3', s3: TEST_S3_CONFIG, source: 'panel' });
    const res = await client.put('/api/admin/settings/storage', { body: { driver: 'local' } });
    expect(res.status).toBe(200);
    expect(view(res)).toMatchObject({ driver: 'local', s3: { hasSecret: true } });
    expect(t.ctx.settings.get('storage')).toEqual({
      driver: 'local',
      s3: TEST_S3_CONFIG,
      source: 'panel',
    });
  });

  it('switching to s3 needs a saved and verified configuration', async () => {
    const { t, client } = await setup();
    t.ctx.settings.set('storage', { driver: 'local', s3: TEST_S3_CONFIG, source: 'env' });
    const { secretAccessKey: _omit, ...input } = TEST_S3_CONFIG;
    const untested = await client.put('/api/admin/settings/storage', {
      body: { driver: 's3', s3: input },
    });
    expect(errorCode(untested)).toBe('STORAGE_NOT_VERIFIED');
    await client.post('/api/admin/settings/storage/test', { body: { s3: input } });
    expect(
      (await client.put('/api/admin/settings/storage', { body: { driver: 's3', s3: input } }))
        .status,
    ).toBe(200);
  });
});

describe('rules while files live on S3', () => {
  async function withS3Files() {
    const ctxApp = await setup({ fakeS3: true });
    const { t } = ctxApp;
    t.ctx.settings.set('storage', { driver: 'local', s3: TEST_S3_CONFIG, source: 'panel' });
    await createTransferFixture(t, { storage: 's3', files: [{ name: 'a.bin', size: 10 }] });
    return ctxApp;
  }
  const { secretAccessKey: _s, ...BASE } = TEST_S3_CONFIG;

  it('refuses a new bucket, endpoint or prefix (STORAGE_IN_USE), even after a test', async () => {
    const { client, t } = await withS3Files();
    for (const change of [
      { bucket: 'another-bucket' },
      { endpoint: 'https://other.example.test' },
      { prefix: 'elsewhere' },
    ]) {
      const s3 = { ...BASE, ...change, secretAccessKey: 'k' };
      await client.post('/api/admin/settings/storage/test', { body: { s3 } });
      const res = await client.put('/api/admin/settings/storage', {
        body: { driver: 'local', s3 },
      });
      expect(res.status, JSON.stringify(change)).toBe(409);
      expect(errorCode(res)).toBe('STORAGE_IN_USE');
    }
    expect(t.ctx.settings.get('storage')?.s3).toEqual(TEST_S3_CONFIG);
  });

  it('allows rotating the access keys and the region after a test', async () => {
    const { client, t } = await withS3Files();
    const s3 = { ...BASE, accessKeyId: 'AKIANEWKEY', secretAccessKey: 'new-secret' };
    expect(
      (await client.put('/api/admin/settings/storage', { body: { driver: 'local', s3 } })).status,
    ).toBe(409); // not tested yet
    await client.post('/api/admin/settings/storage/test', { body: { s3 } });
    const res = await client.put('/api/admin/settings/storage', { body: { driver: 's3', s3 } });
    expect(res.status).toBe(200);
    expect(t.ctx.settings.get('storage')?.s3).toEqual({ ...s3 });
    expect(JSON.stringify(res.body)).not.toContain('new-secret');
  });

  it('refuses endpoint changes while a migration is running, even without S3 files', async () => {
    const { client, t } = await setup();
    t.ctx.settings.set('storage', { driver: 'local', s3: TEST_S3_CONFIG, source: 'panel' });
    t.db.sqlite
      .prepare(
        "INSERT INTO storage_migrations (id, target, status, started_at, updated_at) VALUES ('m1', 's3', 'running', 1, 1)",
      )
      .run();
    const s3 = { ...BASE, bucket: 'another-bucket', secretAccessKey: 'k' };
    await client.post('/api/admin/settings/storage/test', { body: { s3 } });
    const res = await client.put('/api/admin/settings/storage', { body: { driver: 'local', s3 } });
    expect(errorCode(res)).toBe('STORAGE_IN_USE');
  });

  it('lets the bucket change when S3 holds no files', async () => {
    const { client, t } = await setup();
    t.ctx.settings.set('storage', { driver: 'local', s3: TEST_S3_CONFIG, source: 'panel' });
    const s3 = { ...BASE, bucket: 'another-bucket', secretAccessKey: 'k' };
    await client.post('/api/admin/settings/storage/test', { body: { s3 } });
    const res = await client.put('/api/admin/settings/storage', { body: { driver: 's3', s3 } });
    expect(res.status).toBe(200);
    expect(t.ctx.settings.get('storage')?.s3?.bucket).toBe('another-bucket');
  });
});

describe('the driver switch applies at once', () => {
  it('new files go to S3 while the old local files stay downloadable', async () => {
    const { t, fake } = await createFakeS3App({}, { active: false });
    const admin = await t.createUser({ role: 'admin' });
    const client = loginAs(t, admin);
    const oldFile = await createTransferFixture(t, { files: [{ name: 'old.bin', size: 5000 }] });
    expect(t.ctx.storage.currentKind()).toBe('local');

    const { secretAccessKey: _omit, ...input } = TEST_S3_CONFIG;
    // This app has no probe (the default one is unavailable): mark the test as passed directly.
    t.ctx.storageVerification.remember(TEST_S3_CONFIG);
    const res = await client.put('/api/admin/settings/storage', {
      body: { driver: 's3', s3: input },
    });
    expect(res.status).toBe(200);
    expect(t.ctx.storage.currentKind()).toBe('s3');
    expect(t.ctx.storage.current()).toBe(fake);

    const newFile = await createTransferFixture(t, {
      storage: 's3',
      files: [{ name: 'new.bin', size: 3000 }],
    });
    expect(fake.objects.size).toBe(1);

    const download = (fx: typeof oldFile) =>
      binaryRequest(t.app, `/api/downloads/${fx.token}/files/${fx.files[0]!.id}`);
    const old = await download(oldFile);
    expect(old.status).toBe(200);
    expect(old.body.equals(oldFile.files[0]!.content)).toBe(true);
    const fresh = await download(newFile);
    expect(fresh.body.equals(newFile.files[0]!.content)).toBe(true);
  });
});

describe('setup wizard storage step', () => {
  async function unlocked(t: TestApp) {
    const client = await csrfClient(t);
    const res = await client.post('/api/setup/code', { body: { code: t.ctx.setupCode.issue() } });
    expect(res.status).toBe(200);
    return client;
  }

  it('is optional: done with the local default and never blocks completion', async () => {
    const { t } = await setup({ setupCompleted: false });
    const client = await unlocked(t);
    const status = bodyAs<{ steps: Record<string, boolean> }>(
      await client.get('/api/setup/status'),
    );
    expect(status.steps['storage']).toBe(true);

    const early = await client.post('/api/setup/complete');
    // Missing steps are listed, but the storage step is never one of them.
    expect(
      bodyAs<{ error: { details: { missing: string[] } } }>(early).error.details.missing,
    ).not.toContain('storage');
  });

  it('tests, saves and audits the configuration under the setup cookie', async () => {
    const { t, probed } = await setup({ setupCompleted: false });
    const client = await unlocked(t);
    const got = await client.get('/api/setup/storage');
    expect(view(got)).toMatchObject({ driver: 'local', s3: null });

    const s3 = { ...S3_BODY, secretAccessKey: SECRET };
    expect((await client.put('/api/setup/storage', { body: { driver: 's3', s3 } })).status).toBe(
      409,
    );
    expect((await client.post('/api/setup/storage/test', { body: { s3 } })).status).toBe(200);
    expect(probed).toHaveLength(1);
    const saved = await client.put('/api/setup/storage', { body: { driver: 's3', s3 } });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(SECRET);
    expect(t.ctx.settings.get('storage')).toMatchObject({ driver: 's3', source: 'panel' });
    expect(auditActions(t)).toContain('setup.storage_saved');

    const status = bodyAs<{ steps: Record<string, boolean> }>(
      await client.get('/api/setup/status'),
    );
    expect(status.steps['storage']).toBe(true);
  });

  it('keeps the local disk with a simple save and needs the setup cookie', async () => {
    const { t } = await setup({ setupCompleted: false });
    expect((await (await csrfClient(t)).get('/api/setup/storage')).status).toBe(401);
    const client = await unlocked(t);
    const res = await client.put('/api/setup/storage', { body: { driver: 'local' } });
    expect(res.status).toBe(200);
    expect(view(res).driver).toBe('local');
  });
});
