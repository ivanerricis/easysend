import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSetCookie } from 'cookie';
import type { Express } from 'express';
import { afterEach } from 'vitest';
import { pino, type Logger } from 'pino';
import supertest from 'supertest';
import type { Locale, UserRole } from '@easysend/shared';
import { createAppWithContext } from '../src/app.js';
import { createPasswordHasher } from '../src/auth/password.js';
import { generateTotpEnrollment } from '../src/auth/totp.js';
import type { Clock } from '../src/clock.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { AppContext, AppDeps } from '../src/context.js';
import { encryptSecret } from '../src/crypto/aead.js';
import { openDatabase, type DbHandle } from '../src/db/client.js';
import { resolveMigrationsFolder, runMigrations } from '../src/db/migrate.js';
import { users } from '../src/db/schema/index.js';
import type { MailMessage, MailTransport } from '../src/mail/mailer.js';
import type { Secrets } from '../src/secrets.js';

export const silentLogger = pino({ level: 'silent' });

const tempDirs: string[] = [];
const openDbs: DbHandle[] = [];

/** Creates a temp dir removed after each test. DBs are closed first (Windows file locks). */
export function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'easysend-api-'));
  tempDirs.push(dir);
  return dir;
}

/** Opens a DB that is closed automatically after the test. */
export function trackDb(handle: DbHandle): DbHandle {
  openDbs.push(handle);
  return handle;
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', APP_MODE: 'local', ...overrides });
}

/** Migrated in-memory database. */
export async function migratedMemoryDb(): Promise<DbHandle> {
  const handle = trackDb(openDatabase(':memory:'));
  await runMigrations(handle.sqlite, {
    migrationsFolder: resolveMigrationsFolder(),
    backupDir: path.join(makeTempDir(), 'backups'),
    logger: silentLogger,
  });
  return handle;
}

// ---- Secrets, clock, passwords -----------------------------------------------------------

/** Fixed 32-byte master secrets so tests are reproducible. Never used outside tests. */
export const TEST_SECRETS: Secrets = {
  appSecretKey: Buffer.alloc(32, 0xa1),
  sessionSecret: Buffer.alloc(32, 0xb2),
};

/** Cheapest valid argon2 parameters: the production ones would make every login test slow. */
export const FAST_ARGON2 = { memoryCost: 8, timeCost: 1, parallelism: 1 } as const;
export const fastPasswordHasher = () => createPasswordHasher(FAST_ARGON2);

/** Controllable clock: call it for the time, `advance(seconds)` to move it. */
export interface TestClock extends Clock {
  advance(seconds: number): void;
  set(ms: number): void;
}

/** Starts at `startMs` (default: the real current time, so it agrees with SQL defaults). */
export function createTestClock(startMs: number = Date.now()): TestClock {
  let current = startMs;
  const clock = (() => current) as TestClock;
  clock.advance = (seconds) => {
    current += seconds * 1000;
  };
  clock.set = (ms) => {
    current = ms;
  };
  return clock;
}

// ---- Mail --------------------------------------------------------------------------------

/** Transport that records messages instead of sending them. `failWith` makes the next send(s) fail. */
export class RecordingTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  failWith: Error | undefined;

  sendMail(message: MailMessage): Promise<unknown> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push(message);
    return Promise.resolve({ accepted: [message.to] });
  }

  /** The most recent message to `to` (all messages when omitted). */
  last(to?: string): MailMessage | undefined {
    const list = to ? this.sent.filter((m) => m.to === to) : this.sent;
    return list[list.length - 1];
  }

  /** First `token=` query value found in the most recent message to `to`. */
  lastToken(to: string): string | undefined {
    const match = /[?&]token=([A-Za-z0-9_%.-]+)/.exec(this.last(to)?.text ?? '');
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  }
}

// ---- HTTP client with a cookie jar ------------------------------------------------------

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Supertest response with a loosely typed JSON body: tests read fields directly and assert on them.
 * (The body is `any` in supertest; keeping it as an index signature avoids per-line casts.)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TestResponse = Omit<supertest.Response, 'body'> & { body: Record<string, any> };

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * CSRF header: `true` (default) sends `client.csrfToken` when set, a string sends that value,
   * `false` sends none.
   */
  csrf?: boolean | string;
}

/**
 * Supertest wrapper that keeps cookies by hand: the app sets `Secure` cookies and supertest talks
 * plain http, so a normal agent would not send them back. Honors Max-Age=0 (deletion).
 * Set `client.csrfToken` after reading a token from a response.
 */
export class TestClient {
  csrfToken: string | undefined;
  private readonly jar = new Map<string, string>();

  readonly app: Express;

  constructor(app: Express) {
    this.app = app;
  }

  cookie(name: string): string | undefined {
    return this.jar.get(name);
  }

  setCookie(name: string, value: string): void {
    this.jar.set(name, value);
  }

  clearCookies(): void {
    this.jar.clear();
  }

  async request(method: Method, url: string, options: RequestOptions = {}): Promise<TestResponse> {
    const req = supertest(this.app)[method](url);
    if (this.jar.size > 0) {
      req.set('Cookie', [...this.jar].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    const csrf = options.csrf ?? true;
    const token = typeof csrf === 'string' ? csrf : csrf ? this.csrfToken : undefined;
    if (token) req.set('X-CSRF-Token', token);
    for (const [name, value] of Object.entries(options.headers ?? {})) req.set(name, value);
    if (options.body !== undefined) req.send(options.body as object);

    const res = (await req) as TestResponse;
    for (const header of res.headers['set-cookie'] ?? []) {
      const cookie = parseSetCookie(header);
      if (cookie.value === undefined || cookie.value === '' || cookie.maxAge === 0) {
        this.jar.delete(cookie.name);
      } else {
        this.jar.set(cookie.name, cookie.value);
      }
    }
    return res;
  }

  get = (url: string, options?: RequestOptions) => this.request('get', url, options);
  post = (url: string, options?: RequestOptions) => this.request('post', url, options);
  put = (url: string, options?: RequestOptions) => this.request('put', url, options);
  patch = (url: string, options?: RequestOptions) => this.request('patch', url, options);
  delete = (url: string, options?: RequestOptions) => this.request('delete', url, options);
}

// ---- Whole app ---------------------------------------------------------------------------

export interface TestApp {
  app: Express;
  ctx: AppContext;
  config: AppConfig;
  db: DbHandle;
  clock: TestClock;
  /** Records every email the app sends. */
  mailbox: RecordingTransport;
  /** New client with its own cookie jar (call it twice for two browsers). */
  client(): TestClient;
  /** Inserts a user (see `createTestUser`). */
  createUser(input?: TestUserInput): Promise<TestUser>;
}

export interface TestAppOverrides {
  /** Environment variables for `loadConfig`, on top of the local-mode defaults. */
  env?: Record<string, string>;
  logger?: Logger;
  clock?: TestClock;
  /** Any `AppDeps` field (secrets, passwordHasher, mailer, mailTransport...). */
  deps?: Partial<AppDeps>;
}

/**
 * The real app on an in-memory migrated DB with: fixed secrets, a controllable clock, cheap
 * argon2, and a recording mail transport. Every call builds fresh rate limiters.
 */
export async function createTestApp(overrides: TestAppOverrides = {}): Promise<TestApp> {
  const config = testConfig(overrides.env);
  const db = await migratedMemoryDb();
  const clock = overrides.clock ?? createTestClock();
  const mailbox = new RecordingTransport();
  const { app, ctx } = createAppWithContext({
    config,
    db,
    logger: overrides.logger ?? silentLogger,
    secrets: TEST_SECRETS,
    clock,
    passwordHasher: fastPasswordHasher(),
    mailTransport: mailbox,
    ...overrides.deps,
  });
  const testApp: TestApp = {
    app,
    ctx,
    config,
    db,
    clock,
    mailbox,
    client: () => new TestClient(app),
    createUser: (input) => createTestUser(ctx, input),
  };
  return testApp;
}

export interface TestUserInput {
  email?: string;
  password?: string;
  role?: UserRole;
  disabled?: boolean;
  locale?: Locale | null;
  /** Enable TOTP with a fresh secret (returned as `totpSecret`). */
  totp?: boolean;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: UserRole;
  /** Base32 TOTP secret when `totp: true`; use `generateTotpCode(secret, clock())`. */
  totpSecret: string | undefined;
}

let userCounter = 0;

/** Inserts a user with a hashed password (and optionally an encrypted TOTP secret). */
export async function createTestUser(
  ctx: AppContext,
  input: TestUserInput = {},
): Promise<TestUser> {
  userCounter += 1;
  const email = input.email ?? `user${userCounter}@example.com`;
  const password = input.password ?? 'correct-horse-battery';
  const role = input.role ?? 'user';
  const totpSecret = input.totp
    ? generateTotpEnrollment({ email, issuer: 'EasySend' }).secret
    : undefined;
  const row = ctx.db
    .insert(users)
    .values({
      email,
      passwordHash: await ctx.passwordHasher.hash(password),
      role,
      disabled: input.disabled ?? false,
      locale: input.locale ?? null,
      totpEnabled: totpSecret !== undefined,
      totpSecretEnc: totpSecret ? encryptSecret(ctx.keys.totp, 'totp', totpSecret) : null,
    })
    .returning({ id: users.id })
    .get();
  return { id: row.id, email, password, role, totpSecret };
}

afterEach(() => {
  for (const handle of openDbs.splice(0)) {
    if (handle.sqlite.open) handle.sqlite.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
