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
  sessions: SessionService;
  csrf: CsrfService;
  limiters: AuthLimiters;
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
  const mailer =
    deps.mailer ??
    createMailer({
      config,
      settingsRepo: settings,
      logger,
      ...(deps.mailTransport ? { transport: deps.mailTransport } : {}),
    });

  return {
    config,
    db,
    dbHandle: deps.db,
    logger,
    clock,
    keys,
    passwordHasher: deps.passwordHasher ?? createPasswordHasher(),
    settings,
    mailer,
    sessions: createSessionService({ db, clock, clientIp, ipHashKey: keys.ipHash }),
    csrf: createCsrf({ config, csrfKey: keys.csrf }),
    limiters: createAuthLimiters(),
    clientIp,
    ipHashOf: (req) => ipHash(keys.ipHash, clientIp(req)),
  };
}
