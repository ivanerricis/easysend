import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { generateTotpCode } from '../src/auth/totp.js';
import { SETUP_COOKIE } from '../src/http/cookies.js';
import { createLogger } from '../src/logger.js';
import { csrfClient, errorCode, loginWithTotp } from './auth-flow.js';
import { FakeCloudflare } from './fake-cloudflare.js';
import { bodyAs, createTestApp, makeTempDir, type TestApp, type TestClient } from './helpers.js';

const ADMIN = {
  email: 'Boss@Example.com',
  password: 'a-long-passphrase-123',
  displayName: ' Boss ',
};
const SMTP = {
  host: 'smtp.example.com',
  port: 587,
  security: 'starttls' as const,
  username: 'mailer',
  password: 'smtp-secret-pw',
  fromEmail: 'no-reply@example.com',
};
const GENERAL = {
  diskReserveMb: 1024,
  chunkSizeMb: 25,
  defaultLocale: 'en' as const,
  instanceName: 'My Files',
  defaultTheme: 'dark' as const,
};

const details = (res: { body: Record<string, unknown> }): Record<string, unknown> =>
  (res.body['error'] as { details?: Record<string, unknown> }).details ?? {};

/** Browser that entered the setup code. */
async function unlocked(t: TestApp): Promise<TestClient> {
  const client = await csrfClient(t);
  const res = await client.post('/api/setup/code', { body: { code: t.ctx.setupCode.issue() } });
  expect(res.status).toBe(200);
  return client;
}

/** Runs admin + verify, leaving the client with the session-bound CSRF token. */
async function createAdmin(t: TestApp, client: TestClient) {
  const start = await client.post('/api/setup/admin', { body: ADMIN });
  expect(start.status).toBe(200);
  const { secret } = bodyAs<{ secret: string }>(start);
  const verify = await client.post('/api/setup/admin/verify', {
    body: { code: generateTotpCode(secret, t.clock()) },
  });
  expect(verify.status).toBe(201);
  client.csrfToken = bodyAs<{ csrfToken: string }>(verify).csrfToken;
  return { secret, verify };
}

async function saveSmtp(t: TestApp, client: TestClient) {
  expect((await client.post('/api/setup/smtp/test', { body: SMTP })).status).toBe(200);
  const res = await client.put('/api/setup/smtp', { body: SMTP });
  expect(res.status).toBe(200);
  return res;
}

describe('setup wizard: happy path (local mode)', () => {
  it('goes from the code to a completed setup and a working login', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);

    let status = bodyAs<{ codeVerified: boolean; setupCompleted: boolean; appMode: string }>(
      await client.get('/api/setup/status'),
    );
    expect(status).toMatchObject({ codeVerified: true, setupCompleted: false, appMode: 'local' });

    const { secret, verify } = await createAdmin(t, client);
    const body = bodyAs<{ user: Record<string, unknown>; recoveryCodes: string[] }>(verify);
    expect(body.user).toMatchObject({
      email: 'boss@example.com',
      role: 'admin',
      displayName: 'Boss',
    });
    expect(body.recoveryCodes).toHaveLength(10);

    // smtpGet suggests Mailpit before anything is saved.
    const suggestion = bodyAs<{ smtp: Record<string, unknown>; verified: boolean }>(
      await client.get('/api/setup/smtp'),
    );
    expect(suggestion.verified).toBe(false);
    expect(suggestion.smtp).toMatchObject({ host: 'mailpit', port: 1025, security: 'none' });

    const test = await client.post('/api/setup/smtp/test', { body: SMTP });
    expect(bodyAs<{ sentTo: string }>(test).sentTo).toBe('boss@example.com');
    expect(t.mailbox.last('boss@example.com')).toBeDefined();
    const saved = bodyAs<Record<string, unknown>>(
      await client.put('/api/setup/smtp', { body: SMTP }),
    );
    expect(saved).toMatchObject({ host: 'smtp.example.com', hasPassword: true });
    expect(saved).not.toHaveProperty('password');
    expect(JSON.stringify(saved)).not.toContain(SMTP.password);

    // Completing too early lists the missing step.
    const early = await client.post('/api/setup/complete');
    expect(errorCode(early)).toBe('CONFLICT');
    expect(details(early)['missing']).toEqual(['general']);

    expect((await client.put('/api/setup/general', { body: GENERAL })).status).toBe(200);
    expect(t.ctx.settings.getInstanceName()).toBe('My Files');
    expect(t.ctx.settings.getAppearance().defaultTheme).toBe('dark');
    expect(t.ctx.settings.get('general')).toEqual({
      diskReserveMb: 1024,
      chunkSizeMb: 25,
      defaultLocale: 'en',
    });

    status = bodyAs(await client.get('/api/setup/status'));
    expect(status).toMatchObject({
      steps: { admin: true, smtp: true, cloudflare: true, general: true },
    });

    expect((await client.post('/api/setup/complete')).status).toBe(200);
    expect(client.cookie(SETUP_COOKIE)).toBeUndefined();
    expect(t.ctx.settings.get('setup_admin_pending')).toBeUndefined();

    // Everything setup-related is closed now; status stays readable.
    for (const [method, url] of [
      ['get', '/api/setup/smtp'],
      ['put', '/api/setup/general'],
      ['post', '/api/setup/complete'],
      ['post', '/api/setup/admin'],
    ] as const) {
      const res = await client.request(method, url, { body: method === 'get' ? undefined : {} });
      // The cookie was cleared, but "completed" wins over "unauthenticated".
      expect(errorCode(res), url).toBe('SETUP_ALREADY_COMPLETED');
    }
    const fresh = await csrfClient(t);
    expect(
      errorCode(await fresh.post('/api/setup/code', { body: { code: 'AAAA-AAAA-AAAA' } })),
    ).toBe('SETUP_ALREADY_COMPLETED');
    expect(
      bodyAs<{ setupCompleted: boolean }>(await fresh.get('/api/setup/status')).setupCompleted,
    ).toBe(true);

    // The new admin can log in with password + TOTP (a fresh code: the first one is spent).
    t.clock.advance(60);
    const { client: loggedIn } = await loginWithTotp(
      t,
      {
        id: '',
        email: 'boss@example.com',
        password: ADMIN.password,
        role: 'admin',
        totpSecret: secret,
      },
      fresh,
    );
    expect((await loggedIn.get('/api/me')).status).toBe(200);

    const actions = t.db.sqlite
      .prepare("SELECT action FROM audit_log WHERE action LIKE 'setup.%'")
      .all()
      .map((r) => (r as { action: string }).action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'setup.admin_created',
        'setup.smtp_saved',
        'setup.general_saved',
        'setup.completed',
      ]),
    );
  });

  it('keeps the pending password and secret encrypted and out of other responses', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);
    const start = await client.post('/api/setup/admin', { body: ADMIN });
    const { secret } = bodyAs<{ secret: string }>(start);
    const row = t.db.sqlite
      .prepare("SELECT value, is_encrypted FROM settings WHERE key = 'setup_admin_pending'")
      .get() as { value: string; is_encrypted: number };
    expect(row.is_encrypted).toBe(1);
    expect(row.value).not.toContain(secret);
    expect(row.value).not.toContain(ADMIN.password);

    const status = await client.get('/api/setup/status');
    expect(JSON.stringify(status.body)).not.toContain(secret);

    // Calling again replaces the enrolment.
    const again = bodyAs<{ secret: string }>(
      await client.post('/api/setup/admin', { body: ADMIN }),
    );
    expect(again.secret).not.toBe(secret);
    expect(t.ctx.settings.get('setup_admin_pending')?.totpSecret).toBe(again.secret);

    const verify = await client.post('/api/setup/admin/verify', {
      body: { code: generateTotpCode(again.secret, t.clock()) },
    });
    const stored = JSON.stringify(t.db.sqlite.prepare('SELECT * FROM users').all());
    expect(stored).not.toContain(again.secret);
    expect(stored).not.toContain(ADMIN.password);
    expect(JSON.stringify(verify.body)).not.toContain(again.secret);
  });
});

describe('setup wizard: production mode', () => {
  it('requires the cloudflare step, done through POST /api/setup/cloudflare', async () => {
    const fake = new FakeCloudflare();
    const t = await createTestApp({
      setupCompleted: false,
      env: { APP_MODE: 'production', SHARED_DIR: makeTempDir() },
      deps: { cloudflareFetch: fake.fetch },
    });
    const client = await unlocked(t);
    await createAdmin(t, client);
    await saveSmtp(t, client);
    await client.put('/api/setup/general', { body: GENERAL });

    const status = bodyAs<{ steps: { cloudflare: boolean }; appMode: string }>(
      await client.get('/api/setup/status'),
    );
    expect(status).toMatchObject({ appMode: 'production', steps: { cloudflare: false } });

    const early = await client.post('/api/setup/complete');
    expect(errorCode(early)).toBe('CONFLICT');
    expect(details(early)['missing']).toEqual(['cloudflare']);

    // A failed attempt leaves a half-made tunnel behind: the step is still not done.
    const body = { domain: 'example.com', subdomain: 'files', apiToken: 'x'.repeat(40) };
    fake.fail = ['POST /zones/zone-1/dns_records'];
    expect(errorCode(await client.post('/api/setup/cloudflare', { body }))).toBe(
      'CLOUDFLARE_API_ERROR',
    );
    expect(errorCode(await client.post('/api/setup/complete'))).toBe('CONFLICT');

    fake.fail = [];
    const done = await client.post('/api/setup/cloudflare', { body });
    expect(done.status).toBe(200);
    expect(bodyAs<{ publicUrl: string }>(done).publicUrl).toBe('https://files.example.com');
    expect(t.ctx.publicUrl()).toBe('https://files.example.com');
    expect((await client.post('/api/setup/complete')).status).toBe(200);
  });

  it('answers NOT_APPLICABLE_IN_LOCAL_MODE to the cloudflare step in local mode', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);
    const res = await client.post('/api/setup/cloudflare', {
      body: { domain: 'example.com', apiToken: 'x'.repeat(40) },
    });
    expect(errorCode(res)).toBe('NOT_APPLICABLE_IN_LOCAL_MODE');
  });

  it('suggests a blank-ish SMTP form', async () => {
    const t = await createTestApp({
      setupCompleted: false,
      env: { APP_MODE: 'production', PUBLIC_URL: 'https://files.example.com' },
    });
    const client = await unlocked(t);
    const res = bodyAs<{ smtp: { host: string }; verified: boolean }>(
      await client.get('/api/setup/smtp'),
    );
    expect(res.verified).toBe(false);
    expect(res.smtp.host).not.toBe('mailpit');
  });
});

describe('setup code', () => {
  it('rejects wrong codes, then rate limits', async () => {
    const t = await createTestApp({ setupCompleted: false });
    t.ctx.setupCode.issue();
    const client = await csrfClient(t);
    for (let i = 0; i < 9; i += 1) {
      const res = await client.post('/api/setup/code', { body: { code: 'WRONG-CODE-0000' } });
      expect(errorCode(res)).toBe('SETUP_CODE_INVALID');
    }
    const limited = await client.post('/api/setup/code', { body: { code: 'WRONG-CODE-0000' } });
    expect(limited.status).toBe(429);
    expect(errorCode(limited)).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // Even the right code is refused while blocked.
    const right = await client.post('/api/setup/code', { body: { code: t.ctx.setupCode.issue() } });
    expect(errorCode(right)).toBe('RATE_LIMITED');
  });

  it('accepts lowercase and unformatted input', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await csrfClient(t);
    const code = t.ctx.setupCode.issue().toLowerCase().replaceAll('-', ' ');
    expect((await client.post('/api/setup/code', { body: { code } })).status).toBe(200);
  });

  it('is single use', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const code = t.ctx.setupCode.issue();
    const a = await csrfClient(t);
    expect((await a.post('/api/setup/code', { body: { code } })).status).toBe(200);
    const b = await csrfClient(t);
    expect(errorCode(await b.post('/api/setup/code', { body: { code } }))).toBe(
      'SETUP_CODE_INVALID',
    );
  });

  it('expires, and an attempt after expiry issues and logs a new code', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = createLogger(
      { logLevel: 'trace', nodeEnv: 'test', logPretty: false },
      {},
      stream,
    );
    const t = await createTestApp({ setupCompleted: false, logger });
    const old = t.ctx.setupCode.issue();
    t.clock.advance(61 * 60);
    const client = await csrfClient(t);
    expect(errorCode(await client.post('/api/setup/code', { body: { code: old } }))).toBe(
      'SETUP_CODE_EXPIRED',
    );
    const logged = /Setup code: ([A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4})/.exec(lines.join(''));
    expect(logged).not.toBeNull();
    expect(logged![1]).not.toBe(old);
    expect(errorCode(await client.post('/api/setup/code', { body: { code: old } }))).toBe(
      'SETUP_CODE_INVALID',
    );
    expect((await client.post('/api/setup/code', { body: { code: logged![1] } })).status).toBe(200);
  });

  it('needs the CSRF token', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const res = await t.client().post('/api/setup/code', { body: { code: 'x' }, csrf: false });
    expect(errorCode(res)).toBe('CSRF_INVALID');
  });
});

describe('setup cookie', () => {
  it('is required by every setup endpoint', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await csrfClient(t);
    for (const [method, url] of [
      ['post', '/api/setup/admin'],
      ['post', '/api/setup/admin/verify'],
      ['get', '/api/setup/smtp'],
      ['post', '/api/setup/smtp/test'],
      ['put', '/api/setup/smtp'],
      ['put', '/api/setup/general'],
      ['post', '/api/setup/complete'],
    ] as const) {
      const res = await client.request(method, url, { body: method === 'get' ? undefined : {} });
      expect(errorCode(res), url).toBe('UNAUTHENTICATED');
    }
    expect(
      bodyAs<{ codeVerified: boolean }>(await client.get('/api/setup/status')).codeVerified,
    ).toBe(false);
  });

  it('rejects a tampered or expired cookie', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);
    const original = client.cookie(SETUP_COOKIE) as string;
    const [exp, mac] = original.split('.') as [string, string];

    client.setCookie(SETUP_COOKIE, `${Number(exp) + 1000}.${mac}`);
    expect(errorCode(await client.get('/api/setup/smtp'))).toBe('UNAUTHENTICATED');
    client.setCookie(SETUP_COOKIE, `${exp}.${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`);
    expect(errorCode(await client.get('/api/setup/smtp'))).toBe('UNAUTHENTICATED');

    client.setCookie(SETUP_COOKIE, original);
    expect((await client.get('/api/setup/smtp')).status).toBe(200);
    t.clock.advance(13 * 3600);
    expect(errorCode(await client.get('/api/setup/smtp'))).toBe('UNAUTHENTICATED');
  });

  it('needs a CSRF token on unsafe setup requests', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);
    expect(errorCode(await client.post('/api/setup/admin', { body: ADMIN, csrf: false }))).toBe(
      'CSRF_INVALID',
    );
  });
});

describe('setup admin verification', () => {
  it('answers CONFLICT without a pending enrolment', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);
    expect(
      errorCode(await client.post('/api/setup/admin/verify', { body: { code: '123456' } })),
    ).toBe('CONFLICT');
  });

  it('rejects a wrong code and creates nothing', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);
    const { secret } = bodyAs<{ secret: string }>(
      await client.post('/api/setup/admin', { body: ADMIN }),
    );
    const good = generateTotpCode(secret, t.clock());
    const wrong = good === '000000' ? '111111' : '000000';
    expect(errorCode(await client.post('/api/setup/admin/verify', { body: { code: wrong } }))).toBe(
      'INVALID_TOTP_CODE',
    );
    expect(t.db.sqlite.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
  });

  it('answers CONFLICT when an admin exists or the email is taken', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);
    const { secret } = bodyAs<{ secret: string }>(
      await client.post('/api/setup/admin', { body: ADMIN }),
    );
    const code = generateTotpCode(secret, t.clock());

    await t.createUser({ email: 'boss@example.com', role: 'user' });
    expect(errorCode(await client.post('/api/setup/admin/verify', { body: { code } }))).toBe(
      'CONFLICT',
    );

    await t.createUser({ role: 'admin' });
    expect(errorCode(await client.post('/api/setup/admin/verify', { body: { code } }))).toBe(
      'CONFLICT',
    );
    expect(errorCode(await client.post('/api/setup/admin', { body: ADMIN }))).toBe('CONFLICT');
  });

  it('counts an admin created outside the wizard (local CLI) as the admin step', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);
    await t.createUser({ role: 'admin' });
    const status = bodyAs<{ steps: { admin: boolean } }>(await client.get('/api/setup/status'));
    expect(status.steps.admin).toBe(true);
  });
});

describe('setup SMTP', () => {
  it('refuses the test before the admin exists', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);
    expect(errorCode(await client.post('/api/setup/smtp/test', { body: SMTP }))).toBe('CONFLICT');
  });

  it('reports a failed test with a safe code only', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);
    await createAdmin(t, client);
    t.mailbox.failWith = Object.assign(new Error('auth failed for smtp-secret-pw'), {
      code: 'EAUTH',
    });
    const res = await client.post('/api/setup/smtp/test', { body: SMTP });
    expect(errorCode(res)).toBe('SMTP_TEST_FAILED');
    expect(details(res)).toEqual({ code: 'EAUTH' });
    expect(JSON.stringify(res.body)).not.toContain('smtp-secret-pw');
  });

  it('saves only verified settings and keeps the stored password when omitted', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = await unlocked(t);
    await createAdmin(t, client);

    expect(errorCode(await client.put('/api/setup/smtp', { body: SMTP }))).toBe(
      'SMTP_NOT_VERIFIED',
    );
    await client.post('/api/setup/smtp/test', { body: SMTP });
    expect(errorCode(await client.put('/api/setup/smtp', { body: { ...SMTP, port: 2525 } }))).toBe(
      'SMTP_NOT_VERIFIED',
    );
    expect((await client.put('/api/setup/smtp', { body: SMTP })).status).toBe(200);

    const stored = bodyAs<{ smtp: { hasPassword: boolean }; verified: boolean }>(
      await client.get('/api/setup/smtp'),
    );
    expect(stored).toMatchObject({ verified: true, smtp: { hasPassword: true } });

    // Same settings without the password: test and save use the stored one.
    const { password: _omit, ...withoutPassword } = SMTP;
    expect((await client.post('/api/setup/smtp/test', { body: withoutPassword })).status).toBe(200);
    expect((await client.put('/api/setup/smtp', { body: withoutPassword })).status).toBe(200);
    expect(t.ctx.settings.get('smtp')?.password).toBe(SMTP.password);
    const row = t.db.sqlite.prepare("SELECT value FROM settings WHERE key = 'smtp'").get() as {
      value: string;
    };
    expect(row.value).not.toContain(SMTP.password);
  });
});
