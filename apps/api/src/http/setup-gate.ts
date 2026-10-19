import type { RequestHandler } from 'express';
import type { SettingsRepo } from '../settings/repo.js';
import { AppError } from './errors.js';

const ALLOWED_EXACT = new Set(['/api/health', '/api/setup', '/api/public/settings']);
const ALLOWED_PREFIXES = ['/api/setup/', '/api/assets/'];
/** Safe reads the SPA needs before the wizard (CSRF token, "am I logged in"). */
const ALLOWED_GET = new Set(['/api/auth/csrf', '/api/auth/session']);

/**
 * Until the first-run wizard completes, every `/api` request answers 409 `SETUP_REQUIRED` except
 * health, the setup endpoints, public settings, branding assets and the CSRF/session reads.
 * "Completed" never goes back, so it is cached once seen; before that the setting is read per request.
 */
export function createSetupGate(
  settingsRepo: Pick<SettingsRepo, 'isSetupCompleted'>,
): RequestHandler {
  let completed = false;
  return (req, _res, next) => {
    if (completed) return next();
    // Express routes case-insensitively, so `/API/users` must be gated like `/api/users`.
    const lower = req.path.toLowerCase();
    const path = lower.length > 1 ? lower.replace(/\/+$/, '') : lower;
    if (!path.startsWith('/api')) return next();
    // Allowed routes first: health must answer even when the database does not.
    if (
      ALLOWED_EXACT.has(path) ||
      ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
      (req.method === 'GET' && ALLOWED_GET.has(path))
    ) {
      return next();
    }
    if (settingsRepo.isSetupCompleted()) {
      completed = true;
      return next();
    }
    next(new AppError('SETUP_REQUIRED', 'The first-run setup is not completed yet'));
  };
}
