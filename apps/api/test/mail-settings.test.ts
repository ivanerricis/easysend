import net from 'node:net';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { audit } from '../src/audit.js';
import { deriveKeys } from '../src/crypto/keys.js';
import { createMailer } from '../src/mail/mailer.js';
import { createSettingsRepo } from '../src/settings/repo.js';
import {
  RecordingTransport,
  TEST_SECRETS,
  createTestClock,
  migratedMemoryDb,
  testConfig,
} from './helpers.js';

async function makeRepo() {
  const db = await migratedMemoryDb();
  const clock = createTestClock();
  const repo = createSettingsRepo({ db: db.db, keys: deriveKeys(TEST_SECRETS), clock });
  return { db, repo, clock };
}

const smtpSettings = {
  host: '127.0.0.1',
  port: 2525,
  security: 'none' as const,
  username: 'mailer',
  password: 'hunter2-smtp-password',
  fromEmail: 'noreply@example.com',
  fromName: 'EasySend',
};

describe('settings repository', () => {
  it('stores SMTP encrypted at rest and reads it back', async () => {
    const { db, repo } = await makeRepo();
    repo.set('smtp', smtpSettings);

    const raw = db.sqlite
      .prepare("SELECT value, is_encrypted FROM settings WHERE key = 'smtp'")
      .get() as {
      value: string;
      is_encrypted: number;
    };
    expect(raw.is_encrypted).toBe(1);
    expect(raw.value).toMatch(/^"v1:/);
    expect(raw.value).not.toContain('hunter2');
    expect(raw.value).not.toContain('127.0.0.1');
    expect(repo.get('smtp')).toEqual(smtpSettings);
  });

  it('cannot read encrypted values with another key', async () => {
    const { db, repo, clock } = await makeRepo();
    repo.set('smtp', smtpSettings);
    const other = createSettingsRepo({
      db: db.db,
      keys: deriveKeys({ ...TEST_SECRETS, appSecretKey: Buffer.alloc(32, 7) }),
      clock,
    });
    expect(other.get('smtp')).toBeUndefined();
  });

  it('stores plain settings as JSON and overwrites them', async () => {
    const { db, repo } = await makeRepo();
    repo.set('setup_completed', false);
    repo.set('setup_completed', true);
    expect(repo.get('setup_completed')).toBe(true);
    const raw = db.sqlite
      .prepare("SELECT value, is_encrypted FROM settings WHERE key = 'setup_completed'")
      .get();
    expect(raw).toEqual({ value: 'true', is_encrypted: 0 });
    repo.delete('setup_completed');
    expect(repo.get('setup_completed')).toBeUndefined();
  });

  it('ignores stored values that no longer match the schema', async () => {
    const { db, repo } = await makeRepo();
    db.sqlite
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('general', '{\"x\":1}', 1)")
      .run();
    expect(repo.get('general')).toBeUndefined();
  });

  it('defaults the language to it and the name to EasySend', async () => {
    const { repo } = await makeRepo();
    expect(repo.getDefaultLocale()).toBe('it');
    expect(repo.getInstanceName()).toBe('EasySend');
    repo.set('general', { diskReserveMb: 1024, chunkSizeMb: 25, defaultLocale: 'en' });
    expect(repo.getDefaultLocale()).toBe('en');
  });
});

describe('audit', () => {
  it('writes a row with the injected time and no raw IP', async () => {
    const { db } = await makeRepo();
    audit(db.db, {
      actorId: null,
      action: 'auth.login_failed',
      targetType: 'user',
      targetId: 'u1',
      metadata: { reason: 'bad_password' },
      ipHash: 'hash',
      now: 1234,
    });
    expect(db.sqlite.prepare('SELECT * FROM audit_log').get()).toMatchObject({
      actor_id: null,
      action: 'auth.login_failed',
      target_type: 'user',
      target_id: 'u1',
      metadata: '{"reason":"bad_password"}',
      ip_hash: 'hash',
      created_at: 1234,
    });
  });
});

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, logger: pino({ level: 'info' }, stream) };
}

describe('mailer', () => {
  it('builds IT and EN reset links from PUBLIC_URL and records them', async () => {
    const { repo } = await makeRepo();
    const transport = new RecordingTransport();
    const { logger } = captureLogger();
    const mailer = createMailer({
      config: testConfig({ PUBLIC_URL: 'http://localhost:8080' }),
      settingsRepo: repo,
      logger,
      transport,
    });

    expect(
      await mailer.sendPasswordReset({ to: 'a@example.com', locale: null, token: 'tok_1-A' }),
    ).toBe(true);
    const it = transport.last('a@example.com');
    expect(it?.text).toContain('http://localhost:8080/reset-password?token=tok_1-A');
    expect(it?.subject).toContain('reimposta');
    expect(transport.lastToken('a@example.com')).toBe('tok_1-A');

    await mailer.sendPasswordReset({ to: 'b@example.com', locale: 'en', token: 't2' });
    expect(transport.last('b@example.com')?.subject).toContain('reset your password');
    expect(transport.last('b@example.com')?.text).toContain('30 minutes');

    repo.set('general', { diskReserveMb: 1, chunkSizeMb: 25, defaultLocale: 'en' });
    await mailer.sendPasswordReset({ to: 'c@example.com', locale: null, token: 't3' });
    expect(transport.last('c@example.com')?.subject).toContain('reset your password');
  });

  it('sends the welcome link with a 72 hour validity', async () => {
    const { repo } = await makeRepo();
    const transport = new RecordingTransport();
    const mailer = createMailer({
      config: testConfig({ PUBLIC_URL: 'https://files.example.com' }),
      settingsRepo: repo,
      logger: captureLogger().logger,
      transport,
    });
    await mailer.sendWelcome({ to: 'n@example.com', locale: 'en', token: 'welcome-token' });
    const mail = transport.last('n@example.com');
    expect(mail?.text).toContain('https://files.example.com/welcome?token=welcome-token');
    expect(mail?.text).toContain('72 hours');
  });

  it('never throws and logs failures without the error message', async () => {
    const { repo } = await makeRepo();
    const transport = new RecordingTransport();
    transport.failWith = Object.assign(new Error('auth failed for password hunter2'), {
      code: 'EAUTH',
      responseCode: 535,
    });
    const { lines, logger } = captureLogger();
    const mailer = createMailer({ config: testConfig(), settingsRepo: repo, logger, transport });

    expect(await mailer.send({ to: 'a@example.com', subject: 's', text: 't' })).toBe(false);
    const log = lines.join('');
    expect(log).toContain('EAUTH');
    expect(log).not.toContain('hunter2');
  });

  it('fails softly without SMTP in production', async () => {
    const { repo } = await makeRepo();
    const { lines, logger } = captureLogger();
    const mailer = createMailer({
      config: testConfig({
        APP_MODE: 'production',
        PUBLIC_URL: 'https://x.example.com',
        SMTP_DEV_HOST: '127.0.0.1',
        SMTP_DEV_PORT: '2525',
      }),
      settingsRepo: repo,
      logger,
    });
    expect(await mailer.send({ to: 'a@example.com', subject: 's', text: 't' })).toBe(false);
    expect(lines.join('')).toContain('SMTP is not configured');
  });

  it('refuses to build a link without PUBLIC_URL', async () => {
    const { repo } = await makeRepo();
    const transport = new RecordingTransport();
    const mailer = createMailer({
      config: testConfig({ APP_MODE: 'production' }),
      settingsRepo: repo,
      logger: captureLogger().logger,
      transport,
    });
    expect(await mailer.sendPasswordReset({ to: 'a@example.com', locale: 'it', token: 't' })).toBe(
      false,
    );
    expect(transport.sent).toHaveLength(0);
  });
});

/** Minimal SMTP server that records the DATA of each message. */
async function fakeSmtpServer() {
  const messages: string[] = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (inData) {
        if (buffer.endsWith('\r\n.\r\n')) {
          messages.push(buffer);
          buffer = '';
          inData = false;
          socket.write('250 queued\r\n');
        }
        return;
      }
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const command = line.slice(0, 4).toUpperCase();
        if (command === 'EHLO' || command === 'HELO') socket.write('250 test\r\n');
        else if (command === 'DATA') {
          socket.write('354 go ahead\r\n');
          inData = true;
        } else if (command === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
        } else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    messages,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('mailer over real SMTP', () => {
  it('uses the local dev fallback (Mailpit) when no SMTP settings exist', async () => {
    const smtp = await fakeSmtpServer();
    try {
      const { repo } = await makeRepo();
      const mailer = createMailer({
        config: testConfig({ SMTP_DEV_HOST: '127.0.0.1', SMTP_DEV_PORT: String(smtp.port) }),
        settingsRepo: repo,
        logger: captureLogger().logger,
      });
      expect(
        await mailer.send({ to: 'dev@example.com', subject: 'Hello dev', text: 'plain body' }),
      ).toBe(true);
      expect(smtp.messages[0]).toContain('Subject: Hello dev');
      expect(smtp.messages[0]).toContain('plain body');
    } finally {
      await smtp.close();
    }
  });

  it('prefers the stored (encrypted) SMTP settings over the dev fallback', async () => {
    const smtp = await fakeSmtpServer();
    try {
      const { repo } = await makeRepo();
      repo.set('smtp', {
        host: '127.0.0.1',
        port: smtp.port,
        security: 'none',
        fromEmail: 'from@example.com',
      });
      const mailer = createMailer({
        config: testConfig({ SMTP_DEV_HOST: '127.0.0.1', SMTP_DEV_PORT: '1' }),
        settingsRepo: repo,
        logger: captureLogger().logger,
      });
      expect(await mailer.send({ to: 'x@example.com', subject: 'Stored', text: 'body' })).toBe(
        true,
      );
      expect(smtp.messages[0]).toContain('From: from@example.com');
    } finally {
      await smtp.close();
    }
  });
});
