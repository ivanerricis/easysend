import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { emailSchema, passwordSchema } from '@easysend/shared';
import { createPasswordHasher } from '../auth/password.js';
import { eq } from 'drizzle-orm';
import { ConfigError, loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { resolveMigrationsFolder, runMigrations } from '../db/migrate.js';
import { users } from '../db/schema/index.js';
import { createLogger } from '../logger.js';
import { normalizeEmail } from '../users/service.js';

export class CliError extends Error {}

export interface CreateAdminIo {
  /** Writes a line to the console (stdout). */
  log(message: string): void;
  /** Asks for a password without echoing it. Rejects when there is no terminal. */
  promptPassword(label: string): Promise<string>;
}

/** Reads a password from the TTY with hidden input. */
export function promptPasswordFromTty(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.reject(new CliError('No terminal available: pass --password'));
  }
  return new Promise((resolve) => {
    let muted = false;
    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) process.stdout.write(chunk as Uint8Array);
        callback();
      },
    });
    const rl = createInterface({ input: process.stdin, output, terminal: true });
    rl.question(`${label}: `, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

export interface CreateAdminOptions {
  argv: string[];
  env: NodeJS.ProcessEnv;
  io?: CreateAdminIo;
}

/**
 * Creates an administrator WITHOUT 2FA: the first login answers `mfa_setup_required`. Only allowed
 * with APP_MODE=local (in production the first admin is created by the setup wizard).
 * Returns the created email. Throws CliError for any user-facing problem.
 */
export async function runCreateAdmin(options: CreateAdminOptions): Promise<string> {
  const { argv, env } = options;
  const io: CreateAdminIo = options.io ?? {
    log: (message) => console.log(message),
    promptPassword: promptPasswordFromTty,
  };

  const config = loadConfig(env);
  if (config.mode !== 'local') {
    throw new CliError(
      'create-admin only works with APP_MODE=local. In production the first admin is created by the setup wizard.',
    );
  }

  let values: { email?: string; password?: string };
  try {
    ({ values } = parseArgs({
      // pnpm forwards a lone "--" separator: ignore it.
      args: argv.filter((arg) => arg !== '--'),
      options: { email: { type: 'string' }, password: { type: 'string' } },
      strict: true,
    }));
  } catch (error) {
    throw new CliError(
      `${(error as Error).message}. Usage: --email <email> [--password <password>]`,
    );
  }
  if (!values.email) throw new CliError('Missing --email <email>');

  const email = emailSchema.safeParse(normalizeEmail(values.email));
  if (!email.success) throw new CliError('The email is not valid');

  const password = values.password ?? (await io.promptPassword('Password'));
  const validPassword = passwordSchema.safeParse(password);
  if (!validPassword.success) {
    throw new CliError('The password must be between 12 and 128 characters');
  }
  // Hidden input hides typos: a prompted password is asked twice.
  if (values.password === undefined && (await io.promptPassword('Confirm password')) !== password) {
    throw new CliError('The passwords do not match');
  }

  const logger = createLogger(config);
  mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const handle = openDatabase(config.dbPath);
  try {
    await runMigrations(handle.sqlite, {
      migrationsFolder: resolveMigrationsFolder(),
      backupDir: config.dbBackupDir,
      logger,
    });
    if (handle.db.select({ id: users.id }).from(users).where(eq(users.email, email.data)).get()) {
      throw new CliError('A user with that email already exists');
    }
    handle.db
      .insert(users)
      .values({
        email: email.data,
        passwordHash: await createPasswordHasher().hash(validPassword.data),
        role: 'admin',
      })
      .run();
  } finally {
    handle.sqlite.close();
  }

  io.log(`Admin created: ${email.data}`);
  io.log('Log in with this email; you will be asked to set up two-factor authentication.');
  return email.data;
}

// Entry point: skipped when the module is imported (tests call runCreateAdmin directly).
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await runCreateAdmin({ argv: process.argv.slice(2), env: process.env });
  } catch (error) {
    console.error(
      error instanceof CliError || error instanceof ConfigError
        ? error.message
        : 'create-admin failed unexpectedly',
    );
    process.exitCode = 1;
  }
}
