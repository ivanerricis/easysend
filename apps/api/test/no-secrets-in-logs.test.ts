import { Writable } from 'node:stream';
import supertest from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { generateTotpCode } from '../src/auth/totp.js';
import { SESSION_COOKIE } from '../src/http/cookies.js';
import { createLogger } from '../src/logger.js';
import { csrfClient, giveRecoveryCodes, loginWithTotp, postLogin } from './auth-flow.js';
import { bodyAs, createTestApp, type TestApp, type TestClient } from './helpers.js';
import { loginAs } from './session-helpers.js';

/** Logger with the production redaction rules, writing every level to memory. */
function memoryLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const logger = createLogger({ logLevel: 'trace', nodeEnv: 'test', logPretty: false }, {}, stream);
  return { lines, logger };
}

const auditDump = (t: TestApp): string =>
  JSON.stringify(t.db.sqlite.prepare('SELECT * FROM audit_log').all());

/** Collects the strings that must never reach a log line or an audit row. */
class Secrets {
  readonly values = new Map<string, string>();
  add(label: string, value: string | undefined): void {
    if (value) this.values.set(label, value);
  }
  addClient(label: string, client: TestClient): void {
    this.add(`${label} session cookie`, client.cookie(SESSION_COOKIE));
    this.add(`${label} csrf token`, client.csrfToken);
  }
}

/** True when `secret` appears in `text` (digit-only codes must not be part of a longer number). */
function leaks(text: string, secret: string): boolean {
  if (/^\d+$/.test(secret)) return new RegExp(`(?<!\\d)${secret}(?!\\d)`).test(text);
  return text.includes(secret);
}

describe('no secrets in logs or audit rows', () => {
  it('keeps passwords, codes, tokens and cookies out of every log level and the audit log', async () => {
    const { lines, logger } = memoryLogger();
    const t = await createTestApp({ logger });
    const secrets = new Secrets();

    // --- login with password + TOTP, plus failed attempts with wrong values
    const user = await t.createUser({ totp: true });
    secrets.add('password', user.password);
    secrets.add('totp secret', user.totpSecret);
    const wrong = await csrfClient(t);
    secrets.add('wrong password', 'definitely-wrong-password');
    await postLogin(wrong, user, 'definitely-wrong-password');
    const { client } = await loginWithTotp(t, user);
    secrets.addClient('login', client);
    const bad = await csrfClient(t);
    await postLogin(bad, user);
    const badCode = '000000';
    await bad.post('/api/auth/login/2fa', { body: { code: badCode } });

    // --- recovery code login
    t.clock.advance(120);
    const codes = giveRecoveryCodes(t, user.id, 3);
    for (const [i, c] of codes.entries()) secrets.add(`recovery code ${i}`, c);
    const rec = await csrfClient(t);
    await postLogin(rec, user);
    rec.csrfToken = bodyAs<{ csrfToken: string }>(await rec.get('/api/auth/csrf')).csrfToken;
    const recRes = await rec.post('/api/auth/login/recovery', {
      body: { recoveryCode: codes[0] as string },
    });
    expect(recRes.status).toBe(200);
    rec.csrfToken = bodyAs<{ csrfToken: string }>(recRes).csrfToken;
    secrets.addClient('recovery', rec);

    // --- password reset request + confirm
    const resetUser = await t.createUser({ email: 'reset@example.com' });
    secrets.add('old reset-user password', resetUser.password);
    const anon = await csrfClient(t);
    secrets.addClient('anon', anon);
    await anon.post('/api/auth/password-reset/request', { body: { email: resetUser.email } });
    await vi.waitFor(() => expect(t.mailbox.lastToken(resetUser.email)).toBeDefined());
    const resetToken = t.mailbox.lastToken(resetUser.email)!;
    secrets.add('reset token', resetToken);
    const newPassword = 'brand-new-reset-password-1';
    secrets.add('reset new password', newPassword);
    const confirm = await anon.post('/api/auth/password-reset/confirm', {
      body: { token: resetToken, newPassword },
    });
    expect(confirm.status).toBe(200);
    await anon.post('/api/auth/password-reset/confirm', {
      body: { token: 'invalid-token-value-xyz', newPassword },
    });
    secrets.add('invalid token', 'invalid-token-value-xyz');

    // --- admin creates users (welcome email and explicit password)
    const admin = await t.createUser({ role: 'admin', totp: true });
    const adminClient = loginAs(t, admin);
    secrets.addClient('admin', adminClient);
    const welcome = await adminClient.post('/api/admin/users', {
      body: { email: 'welcome@example.com', role: 'user' },
    });
    expect(welcome.status).toBe(201);
    await vi.waitFor(() => expect(t.mailbox.lastToken('welcome@example.com')).toBeDefined());
    secrets.add('welcome token', t.mailbox.lastToken('welcome@example.com'));
    const explicit = 'admin-chosen-password-123';
    secrets.add('admin-set password', explicit);
    const withPassword = await adminClient.post('/api/admin/users', {
      body: { email: 'direct@example.com', role: 'user', password: explicit },
    });
    expect(withPassword.status).toBe(201);

    // --- mail failure: the link (with its token) must not be logged by the error path
    t.mailbox.failWith = new Error('smtp exploded');
    await anon.post('/api/auth/password-reset/request', { body: { email: resetUser.email } });
    t.mailbox.failWith = undefined;

    // --- /me: password change and 2FA enrolment (secret, otpauth URI, recovery codes)
    const me = await t.createUser();
    const meClient = loginAs(t, me);
    secrets.addClient('me', meClient);
    secrets.add('me password', me.password);
    const changed = 'me-changed-password-456';
    secrets.add('me new password', changed);
    const pw = await meClient.post('/api/me/password', {
      body: { currentPassword: me.password, newPassword: changed },
    });
    expect(pw.status).toBe(204);
    // The session id rotated: fetch the token bound to the new one.
    meClient.csrfToken = bodyAs<{ csrfToken: string }>(
      await meClient.get('/api/auth/csrf'),
    ).csrfToken;
    secrets.addClient('me after change', meClient);
    await meClient.post('/api/me/password', {
      body: { currentPassword: 'wrong-current-password', newPassword: changed },
    });
    secrets.add('wrong current password', 'wrong-current-password');
    const setup = bodyAs<{ secret: string; otpauthUri: string }>(
      await meClient.post('/api/me/2fa/setup'),
    );
    secrets.add('enrolment secret', setup.secret);
    secrets.add('otpauth uri', setup.otpauthUri);
    const code = generateTotpCode(setup.secret, t.clock());
    secrets.add('enrolment totp code', code);
    const enable = await meClient.post('/api/me/2fa/enable', { body: { code } });
    expect(enable.status).toBe(200);
    for (const [i, c] of bodyAs<{ recoveryCodes: string[] }>(enable).recoveryCodes.entries()) {
      secrets.add(`new recovery code ${i}`, c);
    }

    // The capture works: requests and the mail failure were logged.
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.some((l) => l.includes('request completed'))).toBe(true);
    expect(lines.some((l) => l.includes('email not sent'))).toBe(true);

    const log = lines.join('\n');
    const audit = auditDump(t);
    const leaked: string[] = [];
    for (const [label, value] of secrets.values) {
      if (leaks(log, value)) leaked.push(`${label} found in logs`);
      if (leaks(audit, value)) leaked.push(`${label} found in audit rows`);
    }
    expect(leaked).toEqual([]);
  });

  it('logs requests without client IPs, headers or download tokens', async () => {
    const { lines, logger } = memoryLogger();
    const t = await createTestApp({ logger });
    const token = 'dlTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const headers = {
      'X-Forwarded-For': '203.0.113.7',
      'CF-Connecting-IP': '198.51.100.9',
      'User-Agent': 'LeakyBrowser/9.9',
    };

    await supertest(t.app).get(`/api/downloads/${token}`).set(headers);
    await supertest(t.app).get(`/api/downloads/${token}/files/f1?probe=secretquery`).set(headers);
    await supertest(t.app).get('/api/public/settings').set(headers);

    const requestLines = lines.filter((l) => l.includes('request completed'));
    expect(requestLines.length).toBeGreaterThanOrEqual(3);
    const log = lines.join('\n').toLowerCase();
    for (const forbidden of [
      '203.0.113.7',
      '198.51.100.9',
      '127.0.0.1',
      '::ffff:',
      token,
      'secretquery',
      'leakybrowser',
      'x-forwarded-for',
      'cf-connecting-ip',
      'user-agent',
      'remoteaddress',
    ]) {
      expect(log, forbidden).not.toContain(forbidden.toLowerCase());
    }
    const entry = JSON.parse(requestLines[0] as string) as Record<string, unknown>;
    expect(entry.req).toEqual({
      id: expect.any(String) as unknown,
      method: 'GET',
      url: '/api/downloads/[token]',
    });
    expect(entry.res).toEqual({ statusCode: expect.any(Number) as unknown });
  });
});
