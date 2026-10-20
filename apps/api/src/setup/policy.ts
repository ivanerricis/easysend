import type { LimitPolicy } from '../auth/policy.js';

const MINUTE = 60;
const HOUR = 3600;

/** Rate limits and fixed durations of the setup wizard and of the admin SMTP/tunnel tools. */
export const SETUP_POLICY = {
  limits: {
    /** Wrong setup codes, per client `ip_hash`. */
    setupCodeIp: { points: 10, durationSeconds: 15 * MINUTE, blockSeconds: 15 * MINUTE },
    /** Wrong setup codes from anywhere (single key). */
    setupCodeGlobal: { points: 30, durationSeconds: HOUR, blockSeconds: HOUR },
    /** SMTP test emails (wizard and admin panel), single key per scope. */
    smtpTest: { points: 10, durationSeconds: HOUR, blockSeconds: HOUR },
    /** Cloudflare tunnel configuration attempts (wizard and admin panel), single key. */
    cloudflare: { points: 10, durationSeconds: HOUR, blockSeconds: HOUR },
    /** Forced "check for updates now" requests of the admin panel, single key. */
    updateCheck: { points: 10, durationSeconds: HOUR, blockSeconds: HOUR },
  } satisfies Record<string, LimitPolicy>,
  /** Validity of the `es_setup` cookie that authorises the wizard after the code. */
  setupCookieSeconds: 12 * HOUR,
  /** Random characters of the setup code (base32, shown as `XXXX-XXXX-XXXX`). */
  setupCodeLength: 12,
} as const;
