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
  'password',
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
