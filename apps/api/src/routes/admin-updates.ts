import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type {
  StartUpdateRequest,
  UpdateRunResponse,
  UpdateRunStatus,
  UpdateStatusQuery,
} from '@easysend/shared';
import { audit } from '../audit.js';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { AppError } from '../http/errors.js';
import { endpointGuards } from '../http/endpoint-guards.js';
import { assertNotLimited } from '../http/rate-limit.js';
import { sendJson, validBody, validQuery } from '../http/validate.js';
import { writeFileAtomic } from '../shared-dir.js';
import {
  REQUEST_FILE,
  RUNNING_TIMEOUT_SECONDS,
  STALE_REQUEST_SECONDS,
  formatRequest,
  readPendingRequest,
  readRunStatus,
  readRunnerInstalled,
  type UpdateRequest,
} from '../updates/run-files.js';

/** Update notice (`admin.updates`) and one-click update (`admin.updateRun`, `admin.updateStart`). */
export function adminUpdatesRouter(ctx: AppContext): Router {
  const router = Router();
  const dir = ctx.config.updateDir;

  const updateCheckEnabled = (): boolean => ctx.settings.get('general')?.updateCheck ?? true;

  const runnerState = async (): Promise<UpdateRunResponse['runner']> => {
    if (ctx.config.mode === 'local') return 'local';
    return (await readRunnerInstalled(dir, ctx.logger)) ? 'installed' : 'missing';
  };

  /** The request still waiting for the runner: none once a status with the same id exists. */
  const pendingOf = (request: UpdateRequest | null, run: UpdateRunStatus | null, now: number) =>
    request && run?.id !== request.id
      ? { ...request, stale: now - request.requestedAt > STALE_REQUEST_SECONDS }
      : null;

  router.get('/admin/updates', ...endpointGuards(ctx.csrf, 'admin.updates'), async (req, res) => {
    const refresh = validQuery<UpdateStatusQuery>(req).refresh === 'true';
    const enabled = updateCheckEnabled();
    // Only a forced check that can reach GitHub counts against the limit, so plain page loads
    // served from the cache never lock the admin out of "Check now".
    if (refresh && enabled) {
      assertNotLimited(res, await ctx.setupLimiters.updateCheck.consume('refresh'));
    }
    sendJson(res, 'admin.updates', 200, await ctx.updates.status({ enabled, refresh }));
  });

  router.get(
    '/admin/updates/run',
    ...endpointGuards(ctx.csrf, 'admin.updateRun'),
    async (_req, res) => {
      const runner = await runnerState();
      if (runner === 'local') {
        sendJson(res, 'admin.updateRun', 200, { runner, pending: null, run: null });
        return;
      }
      const [request, run] = await Promise.all([
        readPendingRequest(dir, ctx.logger),
        readRunStatus(dir, ctx.logger),
      ]);
      const pending = pendingOf(request, run, nowSeconds(ctx.clock));
      sendJson(res, 'admin.updateRun', 200, { runner, pending, run });
    },
  );

  router.post(
    '/admin/updates/run',
    ...endpointGuards(ctx.csrf, 'admin.updateStart'),
    async (req, res) => {
      const { version } = validBody<StartUpdateRequest>(req);
      const runner = await runnerState();
      if (runner === 'local') {
        throw new AppError(
          'NOT_APPLICABLE_IN_LOCAL_MODE',
          'The one-click update needs APP_MODE=production',
        );
      }
      if (runner === 'missing') {
        throw new AppError('UPDATE_RUNNER_MISSING', 'The host update runner is not installed');
      }

      const now = nowSeconds(ctx.clock);
      const [request, run] = await Promise.all([
        readPendingRequest(dir, ctx.logger),
        readRunStatus(dir, ctx.logger),
      ]);
      const pending = pendingOf(request, run, now);
      const running =
        run !== null && run.state === 'running' && now - run.updatedAt < RUNNING_TIMEOUT_SECONDS;
      if ((pending && !pending.stale) || running) {
        throw new AppError('UPDATE_IN_PROGRESS', 'An update is already requested or running');
      }

      // Counted here, after the cheap refusals: this is the step that may contact GitHub.
      assertNotLimited(res, await ctx.setupLimiters.updateStart.consume('start'));
      if (!(await ctx.updates.isAvailable(version, { enabled: updateCheckEnabled() }))) {
        throw new AppError(
          'UPDATE_VERSION_NOT_AVAILABLE',
          'The version is not a published release newer than the running one',
        );
      }

      const created: UpdateRequest = {
        id: randomBytes(16).toString('hex'),
        version,
        requestedAt: now,
      };
      try {
        await writeFileAtomic(dir, REQUEST_FILE, formatRequest(created), 0o640);
      } catch (error) {
        ctx.logger.error(
          { code: (error as NodeJS.ErrnoException).code },
          'could not write the update request',
        );
        throw new AppError('INTERNAL_ERROR', 'The update request could not be written');
      }
      audit(ctx.db, {
        actorId: req.auth?.user.id ?? null,
        action: 'system.update_requested',
        targetType: 'system',
        metadata: { from: ctx.config.version, to: version },
        ipHash: ctx.ipHashOf(req),
        now,
      });
      sendJson(res, 'admin.updateStart', 202, created);
    },
  );

  return router;
}
