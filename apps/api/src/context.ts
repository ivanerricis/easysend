import type { AppConfig } from './config.js';
import { createPasswordHasher, type PasswordHasher } from './auth/password.js';
import { createAuthLimiters, type AuthLimiters } from './auth/limiters.js';
import { createSessionService, type SessionService } from './auth/session.js';
import { systemClock, type Clock } from './clock.js';
import { deriveKeys, type DerivedKeys } from './crypto/keys.js';
import type { S3Config, StorageDriverKind } from '@easysend/shared';
import type { Db, DbHandle } from './db/client.js';
import { createClientIpResolver, ipHash, type ClientIpResolver } from './http/client-ip.js';
import { createCsrf, type CsrfService } from './http/csrf.js';
import type { Logger } from './logger.js';
import { createMailer, type MailTransport, type Mailer } from './mail/mailer.js';
import type { Secrets } from './secrets.js';
import { createSettingsRepo, type SettingsRepo } from './settings/repo.js';
import { createSmtpVerification, type SmtpVerification } from './settings/smtp-verification.js';
import { statfsDiskSpace, type DiskSpace } from './storage/disk.js';
import { createStorageRegistry, type StorageRegistry } from './storage/registry.js';
import { createS3Driver, probeS3 } from './storage/s3/driver.js';
import type { StorageDriver } from './storage/types.js';
import { createStorageVerification, type StorageVerification } from './storage/verification.js';
import { createSetupCodeService, type SetupCodeService } from './setup/code.js';
import { createSetupLimiters, type SetupLimiters } from './setup/limiters.js';
import { createUpdateLimiters, type UpdateLimiters } from './updates/policy.js';
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
  /** Ready-made storage drivers that win over the built ones (tests inject an in-memory fake). */
  storageDrivers?: Partial<Record<StorageDriverKind, StorageDriver>>;
  /** `fetch` used for the Cloudflare API. Default: `globalThis.fetch`. Tests inject a fake. */
  cloudflareFetch?: typeof fetch;
  /** `fetch` used for the S3 storage API. Default: `globalThis.fetch`. Tests inject a fake S3 server. */
  storageFetch?: typeof fetch;
  /** S3 multipart part size in bytes. Default `S3_PART_SIZE_BYTES`; tests use small parts. */
  storagePartSizeBytes?: number;
  /** Base of the S3 retry backoff in ms. Default 250; tests pass 0. */
  storageRetryDelayMs?: number;
  /** S3 connection test. Default `probeS3` on `storageFetch`; tests can replace it. */
  storageProbe?: (config: S3Config) => Promise<void>;
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
  /** Remembers the last S3 configuration that passed a connection test (wizard and panel). */
  storageVerification: StorageVerification;
  /** `fetch` for the Cloudflare API (injectable for tests). */
  cloudflareFetch: typeof fetch;
  /**
   * Connection test of an S3 configuration (write, ranged read, delete, list). Throws
   * `STORAGE_UNAVAILABLE` with a safe `details.reason`.
   */
  storageProbe: (config: S3Config) => Promise<void>;
  /** Latest-release check behind the admin update notice (cached, on demand only). */
  updates: UpdateService;
  sessions: SessionService;
  csrf: CsrfService;
  limiters: AuthLimiters;
  transferLimiters: TransferLimiters;
  setupLimiters: SetupLimiters;
  updateLimiters: UpdateLimiters;
  /** One-time code that authorises the first-run wizard (in memory, printed in the logs). */
  setupCode: SetupCodeService;
  diskSpace: DiskSpace;
  /** Driver for new files and driver of an existing file (`current()` / `forFile(kind)`). */
  storage: StorageRegistry;
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
  const diskSpace = deps.diskSpace ?? statfsDiskSpace;
  const storageFetch = deps.storageFetch ?? globalThis.fetch;
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
    storageVerification: createStorageVerification(clock),
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
    updateLimiters: createUpdateLimiters(),
    setupCode: createSetupCodeService({
      clock,
      ttlMinutes: config.setupCodeTtlMinutes,
      logger,
    }),
    diskSpace,
    storageProbe:
      deps.storageProbe ?? ((cfg: S3Config) => probeS3(cfg, { fetch: storageFetch, logger })),
    storage: createStorageRegistry({
      config,
      settings,
      logger,
      diskSpace,
      s3Factory: (cfg) =>
        createS3Driver(cfg, {
          fetch: storageFetch,
          logger,
          now: () => clock(),
          ...(deps.storagePartSizeBytes === undefined
            ? {}
            : { partSize: deps.storagePartSizeBytes }),
          ...(deps.storageRetryDelayMs === undefined
            ? {}
            : { retryDelayMs: deps.storageRetryDelayMs }),
        }),
      ...(deps.storageDrivers ? { overrides: deps.storageDrivers } : {}),
    }),
    publicUrl,
    clientIp,
    ipHashOf: (req: Parameters<ClientIpResolver>[0]) => ipHash(keys.ipHash, clientIp(req)),
  } as AppContext;
  ctx.uploadWorker = createUploadWorker(ctx);
  return ctx;
}
