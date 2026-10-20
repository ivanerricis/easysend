import type { AppConfig } from './config.js';
import { createPasswordHasher, type PasswordHasher } from './auth/password.js';
import { createAuthLimiters, type AuthLimiters } from './auth/limiters.js';
import { createSessionService, type SessionService } from './auth/session.js';
import { systemClock, type Clock } from './clock.js';
import { deriveKeys, type DerivedKeys } from './crypto/keys.js';
import type { Db, DbHandle } from './db/client.js';
import { createClientIpResolver, ipHash, type ClientIpResolver } from './http/client-ip.js';
import { createCsrf, type CsrfService } from './http/csrf.js';
import type { Logger } from './logger.js';
import { createMailer, type MailTransport, type Mailer } from './mail/mailer.js';
import type { Secrets } from './secrets.js';
import { createSettingsRepo, type SettingsRepo } from './settings/repo.js';
import { createSmtpVerification, type SmtpVerification } from './settings/smtp-verification.js';
import { statfsDiskSpace, type DiskSpace } from './storage/disk.js';
import { createSetupCodeService, type SetupCodeService } from './setup/code.js';
import { createSetupLimiters, type SetupLimiters } from './setup/limiters.js';
import { createTransferLimiters, type TransferLimiters } from './transfers/limiters.js';
import { createUpdateService, type UpdateService } from './updates/service.js';
import { createUploadWorker, type UploadWorker } from './uploads/worker.js';

/** What the application is built from. Everything but the first four is optional (defaults for production). */
export interface AppDeps {
  config: AppConfig;
  db: DbHandle;
  logger: Logger;
  secrets: Secrets;
  /** Time source in ms. Default: the system clock. */
  clock?: Clock;
  /** Default: argon2id with the policy parameters. Tests pass cheap ones. */
  passwordHasher?: PasswordHasher;
  /** Default: built from the settings repository. */
  mailer?: Mailer;
  /** Replaces the SMTP connection of the default mailer (tests record messages with it). */
  mailTransport?: MailTransport;
  /** Free-space probe of the storage disk. Default: `fs.statfs`. Tests fake a full disk with it. */
  diskSpace?: DiskSpace;
  /** `fetch` used for the Cloudflare API. Default: `globalThis.fetch`. Tests inject a fake. */
  cloudflareFetch?: typeof fetch;
  /** `fetch` used for the GitHub release check. Default: `globalThis.fetch`. Tests inject a fake. */
  updateFetch?: typeof fetch;
}

/** Everything a route needs, built once per app. Route factories receive it: no global state. */
export interface AppContext {
  config: AppConfig;
  /** Drizzle handle. The raw SQLite handle is `dbHandle.sqlite`. */
  db: Db;
  dbHandle: DbHandle;
  logger: Logger;
  clock: Clock;
  keys: DerivedKeys;
  passwordHasher: PasswordHasher;
  settings: SettingsRepo;
  mailer: Mailer;
  /** Remembers the last SMTP configuration that passed a test email (wizard and admin panel). */
  smtpVerification: SmtpVerification;
  /** `fetch` for the Cloudflare API (injectable for tests). */
  cloudflareFetch: typeof fetch;
  /** Latest-release check behind the admin update notice (cached, on demand only). */
  updates: UpdateService;
  sessions: SessionService;
  csrf: CsrfService;
  limiters: AuthLimiters;
  transferLimiters: TransferLimiters;
  setupLimiters: SetupLimiters;
  /** One-time code that authorises the first-run wizard (in memory, printed in the logs). */
  setupCode: SetupCodeService;
  diskSpace: DiskSpace;
  /** Background queue that hashes and encrypts finished uploads (one per app). */
  uploadWorker: UploadWorker;
  /**
   * Public base URL: env `PUBLIC_URL`, else the `public_url` setting (wizard), else the local-mode
   * default. Undefined in production before the wizard. Read per call: it can change at runtime.
   */
  publicUrl(): string | undefined;
  /** Real client address (see `createClientIpResolver`). Never log it: use `ipHashOf`. */
  clientIp: ClientIpResolver;
  /** `ip_hash` value for the audit log and sessions. */
  ipHashOf(req: Parameters<ClientIpResolver>[0]): string;
}

export function createContext(deps: AppDeps): AppContext {
  const { config, logger } = deps;
  const clock = deps.clock ?? systemClock;
  const keys = deriveKeys(deps.secrets);
  const db = deps.db.db;
  const clientIp = createClientIpResolver(config);
  const settings = createSettingsRepo({ db, keys, clock });
  const publicUrl = (): string | undefined =>
    config.publicUrlEnv ?? settings.get('public_url') ?? config.publicUrl;
  const mailer =
    deps.mailer ??
    createMailer({
      config,
      settingsRepo: settings,
      publicUrl,
      logger,
      ...(deps.mailTransport ? { transport: deps.mailTransport } : {}),
    });

  // The worker reads the context only when it runs, so it can be attached after the object exists.
  const ctx = {
    config,
    db,
    dbHandle: deps.db,
    logger,
    clock,
    keys,
    passwordHasher: deps.passwordHasher ?? createPasswordHasher(),
    settings,
    mailer,
    smtpVerification: createSmtpVerification(clock),
    cloudflareFetch: deps.cloudflareFetch ?? globalThis.fetch,
    updates: createUpdateService({
      url: config.updateCheckUrl,
      currentVersion: config.version,
      fetch: deps.updateFetch ?? globalThis.fetch,
      clock,
      logger,
    }),
    sessions: createSessionService({ db, clock, clientIp, ipHashKey: keys.ipHash }),
    csrf: createCsrf({ publicUrl, csrfKey: keys.csrf }),
    limiters: createAuthLimiters(),
    transferLimiters: createTransferLimiters(),
    setupLimiters: createSetupLimiters(),
    setupCode: createSetupCodeService({
      clock,
      ttlMinutes: config.setupCodeTtlMinutes,
      logger,
    }),
    diskSpace: deps.diskSpace ?? statfsDiskSpace,
    publicUrl,
    clientIp,
    ipHashOf: (req: Parameters<ClientIpResolver>[0]) => ipHash(keys.ipHash, clientIp(req)),
  } as AppContext;
  ctx.uploadWorker = createUploadWorker(ctx);
  return ctx;
}
