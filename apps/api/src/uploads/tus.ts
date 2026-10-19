import { Router } from 'express';
import type { AppContext } from '../context.js';

/**
 * tus upload endpoint at `/api/uploads` (phase 3, WP2). `app.ts` mounts this router BEFORE the
 * JSON body parser because tus must read the raw request stream.
 *
 * WP2 fills it with `app.all`-style routes for `/api/uploads` and `/api/uploads/*` (kept at the
 * absolute path so the URL prefix reaches @tus/server) running: cookie parsing, `rejectCrossSite`,
 * `loadSession`, `requireAuth('session')`, CSRF on unsafe methods, the `HEAD` shortcut for
 * `processing`/`completed` uploads, then `tus.handle(req, res)` with the `@tus/server` `Server`
 * on a `@tus/file-store` `FileStore` in `TMP_UPLOAD_DIR`. Empty until then.
 */
export function uploadsRouter(_ctx: AppContext): Router {
  return Router();
}
