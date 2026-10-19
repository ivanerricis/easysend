import path from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { CliError, runCreateAdmin, type CreateAdminIo } from '../src/cli/create-admin.js';
import { openDatabase } from '../src/db/client.js';
import { users } from '../src/db/schema/index.js';
import { createPasswordHasher } from '../src/auth/password.js';
import { makeTempDir } from './helpers.js';

function cliEnv(overrides: Record<string, string> = {}) {
  const dir = makeTempDir();
  return {
    dbPath: path.join(dir, 'db', 'app.sqlite'),
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      APP_MODE: 'local',
      DATA_DIR: dir,
      DB_PATH: path.join(dir, 'db', 'app.sqlite'),
      DB_BACKUP_DIR: path.join(dir, 'backups'),
      ...overrides,
    },
  };
}

function fakeIo(password = 'prompted-password-123') {
  const lines: string[] = [];
  const io: CreateAdminIo = {
    log: (message) => lines.push(message),
    promptPassword: () => Promise.resolve(password),
  };
  return { io, lines };
}

function readUsers(dbPath: string) {
  const handle = openDatabase(dbPath);
  try {
    return handle.db.select().from(users).all();
  } finally {
    handle.sqlite.close();
  }
}

describe('create-admin CLI', () => {
  it('refuses to run outside APP_MODE=local and creates nothing', async () => {
    const { env, dbPath } = cliEnv({ APP_MODE: 'production' });
    const { io } = fakeIo();
    await expect(
      runCreateAdmin({ argv: ['--email', 'a@example.com', '--password', 'x'.repeat(14)], env, io }),
    ).rejects.toThrow(/APP_MODE=local/);
    await expect(
      runCreateAdmin({ argv: ['--email', 'a@example.com'], env: { ...env, APP_MODE: '' }, io }),
    ).rejects.toBeInstanceOf(Error);
    // The database was never even created.
    expect(() => readUsers(dbPath)).toThrow();
  });

  it('refuses when APP_MODE is not set at all (production is the default)', async () => {
    const { env } = cliEnv();
    delete (env as Record<string, string | undefined>).APP_MODE;
    await expect(
      runCreateAdmin({ argv: ['--email', 'a@example.com', '--password', 'x'.repeat(14)], env }),
    ).rejects.toThrow(CliError);
  });

  it('creates an admin without 2FA, with a verifiable password, and prints only the email', async () => {
    const { env, dbPath } = cliEnv();
    const { io, lines } = fakeIo();
    const email = await runCreateAdmin({
      argv: ['--email', ' Admin@Example.com ', '--password', 'a-long-enough-password'],
      env,
      io,
    });
    expect(email).toBe('admin@example.com');

    const [row, ...rest] = readUsers(dbPath);
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      email: 'admin@example.com',
      role: 'admin',
      totpEnabled: false,
      totpSecretEnc: null,
      disabled: false,
    });
    expect(await createPasswordHasher().verify(row!.passwordHash, 'a-long-enough-password')).toBe(
      true,
    );
    const output = lines.join('\n');
    expect(output).toContain('admin@example.com');
    expect(output).not.toContain('a-long-enough-password');
    expect(output).not.toContain(row!.passwordHash);
  });

  it('prompts for the password when --password is missing', async () => {
    const { env, dbPath } = cliEnv();
    const { io } = fakeIo('prompted-password-123');
    await runCreateAdmin({ argv: ['--email', 'p@example.com'], env, io });
    const [row] = readUsers(dbPath);
    expect(await createPasswordHasher().verify(row!.passwordHash, 'prompted-password-123')).toBe(
      true,
    );
  });

  it('fails without a terminal and without --password', async () => {
    const { env } = cliEnv();
    const io: CreateAdminIo = {
      log: () => undefined,
      promptPassword: () => Promise.reject(new CliError('No terminal available: pass --password')),
    };
    await expect(runCreateAdmin({ argv: ['--email', 'p@example.com'], env, io })).rejects.toThrow(
      /No terminal/,
    );
  });

  it('accepts the lone "--" separator forwarded by pnpm', async () => {
    const { env } = cliEnv();
    const { io } = fakeIo();
    await expect(
      runCreateAdmin({
        argv: ['--', '--email', 'sep@example.com', '--password', 'x'.repeat(14)],
        env,
        io,
      }),
    ).resolves.toBe('sep@example.com');
  });

  it('rejects an invalid email, a short password and a missing email', async () => {
    const { env, dbPath } = cliEnv();
    const { io } = fakeIo();
    await expect(
      runCreateAdmin({ argv: ['--email', 'not-an-email', '--password', 'x'.repeat(14)], env, io }),
    ).rejects.toThrow(/email/);
    await expect(
      runCreateAdmin({ argv: ['--email', 'a@example.com', '--password', 'short'], env, io }),
    ).rejects.toThrow(/password/);
    await expect(runCreateAdmin({ argv: [], env, io })).rejects.toThrow(/--email/);
    await expect(
      runCreateAdmin({ argv: ['--email', 'a@example.com', '--bogus'], env, io }),
    ).rejects.toThrow(CliError);
    expect(() => readUsers(dbPath)).toThrow();
  });

  it('refuses an email that already exists', async () => {
    const { env, dbPath } = cliEnv();
    const { io } = fakeIo();
    const argv = ['--email', 'dup@example.com', '--password', 'a-long-enough-password'];
    await runCreateAdmin({ argv, env, io });
    await expect(runCreateAdmin({ argv, env, io })).rejects.toThrow(/already exists/);
    expect(readUsers(dbPath).filter((u) => u.email === 'dup@example.com')).toHaveLength(1);
    const handle = openDatabase(dbPath);
    expect(handle.db.select().from(users).where(eq(users.role, 'admin')).all()).toHaveLength(1);
    handle.sqlite.close();
  });
});
