import { pino, type Logger, type LoggerOptions } from 'pino';
import type { AppConfig } from './config.js';

export type { Logger };

const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.recoveryCode',
  '*.newPassword',
  '*.currentPassword',
  '*.csrfToken',
  '*.otpauthUri',
  'req.headers["x-csrf-token"]',
  'req.body.code',
  'password',
  // `code` is redacted only at the top level and in request bodies: `*.code` would also hide
  // the useful `err.code` (ECONNREFUSED...).
  'code',
  'recoveryCode',
  'newPassword',
  'currentPassword',
  'csrfToken',
  'otpauthUri',
  'secret',
  'token',
];

export function createLogger(
  config: Pick<AppConfig, 'logLevel' | 'nodeEnv' | 'logPretty'>,
  overrides: LoggerOptions = {},
): Logger {
  const pretty = config.nodeEnv !== 'production' && (process.stdout.isTTY || config.logPretty);
  return pino({
    level: config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
    ...overrides,
  });
}
