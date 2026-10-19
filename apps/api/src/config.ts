import path from 'node:path';
import { z } from 'zod';
import { APP_MODES, CHUNK_SIZE_MB, type AppMode } from '@easysend/shared';

/** Thrown when environment variables are invalid. The message lists variable names only, never values. */
export class ConfigError extends Error {
  readonly variables: string[];

  constructor(variables: string[]) {
    super(`Invalid environment configuration: ${variables.join(', ')}`);
    this.name = 'ConfigError';
    this.variables = variables;
  }
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const NODE_ENVS = ['development', 'production', 'test'] as const;

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');
const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().nonnegative();

const envSchema = z.object({
  APP_MODE: z.enum(APP_MODES).default('production'),
  PUBLIC_URL: z.url().optional(),
  TZ: z.string().min(1).default('Europe/Rome'),
  NODE_ENV: z.enum(NODE_ENVS).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  LOG_PRETTY: boolish.default(false),
  TRUST_PROXY: nonNegativeInt.optional(),
  DATA_DIR: z.string().min(1).default('/data'),
  DB_PATH: z.string().min(1).optional(),
  STORAGE_DIR: z.string().min(1).optional(),
  TMP_UPLOAD_DIR: z.string().min(1).optional(),
  BRANDING_DIR: z.string().min(1).optional(),
  SHARED_DIR: z.string().min(1).default('/shared'),
  SETUP_CODE_TTL_MINUTES: positiveInt.default(60),
  PASSWORD_RESET_TTL_MINUTES: positiveInt.default(30),
  LOG_RETENTION_DAYS: positiveInt.default(90),
  INCOMPLETE_UPLOAD_TTL_HOURS: positiveInt.default(24),
  CLEANUP_CRON: z.string().min(1).default('0 * * * *'),
  DEFAULT_DISK_RESERVE_MB: nonNegativeInt.default(1024),
  DEFAULT_CHUNK_SIZE_MB: z.coerce
    .number()
    .int()
    .min(1)
    .max(CHUNK_SIZE_MB.max)
    .default(CHUNK_SIZE_MB.default),
  APP_VERSION: z.string().min(1).optional(),
});

export interface AppConfig {
  mode: AppMode;
  publicUrl: string | undefined;
  timezone: string;
  nodeEnv: (typeof NODE_ENVS)[number];
  port: number;
  logLevel: (typeof LOG_LEVELS)[number];
  logPretty: boolean;
  trustProxy: number;
  dataDir: string;
  dbPath: string;
  dbBackupDir: string;
  storageDir: string;
  tmpUploadDir: string;
  brandingDir: string;
  secretsDir: string;
  sharedDir: string;
  setupCodeTtlMinutes: number;
  passwordResetTtlMinutes: number;
  logRetentionDays: number;
  incompleteUploadTtlHours: number;
  cleanupCron: string;
  defaultDiskReserveMb: number;
  defaultChunkSizeMb: number;
  version: string;
}

export const DEFAULT_LOCAL_PUBLIC_URL = 'http://localhost:8080';
export const DEV_VERSION = '0.0.0-dev';

/** Pure parse of an environment object. Empty strings count as unset. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const cleaned: Record<string, string> = {};
  for (const key of Object.keys(envSchema.shape)) {
    const value = env[key];
    if (value !== undefined && value.trim() !== '') cleaned[key] = value.trim();
  }

  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const names = new Set<string>();
    for (const issue of parsed.error.issues) names.add(String(issue.path[0] ?? 'ENV'));
    throw new ConfigError([...names].sort());
  }

  const e = parsed.data;
  const dataDir = e.DATA_DIR;
  const publicUrl = e.PUBLIC_URL ?? (e.APP_MODE === 'local' ? DEFAULT_LOCAL_PUBLIC_URL : undefined);
  const dbPath = e.DB_PATH ?? path.join(dataDir, 'db', 'app.sqlite');

  return {
    mode: e.APP_MODE,
    publicUrl,
    timezone: e.TZ,
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    logPretty: e.LOG_PRETTY,
    trustProxy: e.TRUST_PROXY ?? (e.APP_MODE === 'local' ? 1 : 2),
    dataDir,
    dbPath,
    dbBackupDir: path.join(path.dirname(dbPath), 'backups'),
    storageDir: e.STORAGE_DIR ?? path.join(dataDir, 'storage'),
    tmpUploadDir: e.TMP_UPLOAD_DIR ?? path.join(dataDir, 'tmp'),
    brandingDir: e.BRANDING_DIR ?? path.join(dataDir, 'branding'),
    secretsDir: path.join(dataDir, 'secrets'),
    sharedDir: e.SHARED_DIR,
    setupCodeTtlMinutes: e.SETUP_CODE_TTL_MINUTES,
    passwordResetTtlMinutes: e.PASSWORD_RESET_TTL_MINUTES,
    logRetentionDays: e.LOG_RETENTION_DAYS,
    incompleteUploadTtlHours: e.INCOMPLETE_UPLOAD_TTL_HOURS,
    cleanupCron: e.CLEANUP_CRON,
    defaultDiskReserveMb: e.DEFAULT_DISK_RESERVE_MB,
    defaultChunkSizeMb: e.DEFAULT_CHUNK_SIZE_MB,
    version: e.APP_VERSION ?? DEV_VERSION,
  };
}
