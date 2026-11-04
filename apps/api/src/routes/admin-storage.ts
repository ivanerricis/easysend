import { Router } from 'express';
import type {
  StorageMigrationStartRequest,
  StorageTestRequest,
  StorageUpdateRequest,
} from '@easysend/shared';
import { auditRequest } from '../audit.js';
import type { AppContext } from '../context.js';
import { endpointGuards } from '../http/endpoint-guards.js';
import { assertNotLimited } from '../http/rate-limit.js';
import { sendJson, validBody } from '../http/validate.js';
import { cancelMigration, latestMigration, startMigration } from '../storage/migrate.js';
import {
  saveStorageSettings,
  storageSettingsView,
  testStorageConfig,
} from '../storage/settings.js';

/** File storage configuration (`settings.storage*`) and the migration job (`storage.migration*`). */
export function adminStorageRouter(ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/admin/settings/storage',
    ...endpointGuards(ctx.csrf, 'settings.storage'),
    (_req, res) => {
      sendJson(res, 'settings.storage', 200, storageSettingsView(ctx));
    },
  );

  router.post(
    '/admin/settings/storage/test',
    ...endpointGuards(ctx.csrf, 'settings.storageTest'),
    async (req, res) => {
      assertNotLimited(res, await ctx.setupLimiters.storageTest.consume('admin'));
      await testStorageConfig(ctx, validBody<StorageTestRequest>(req).s3);
      sendJson(res, 'settings.storageTest', 200, { ok: true });
    },
  );

  router.put(
    '/admin/settings/storage',
    ...endpointGuards(ctx.csrf, 'settings.storageUpdate'),
    (req, res) => {
      const view = saveStorageSettings(ctx, validBody<StorageUpdateRequest>(req));
      auditRequest(ctx, req, 'settings.storage_updated', {
        targetType: 'settings',
        metadata: { driver: view.driver, source: view.source },
      });
      sendJson(res, 'settings.storageUpdate', 200, view);
    },
  );

  router.get(
    '/admin/storage/migration',
    ...endpointGuards(ctx.csrf, 'storage.migration'),
    (_req, res) => {
      sendJson(res, 'storage.migration', 200, { migration: latestMigration(ctx) });
    },
  );

  router.post(
    '/admin/storage/migration',
    ...endpointGuards(ctx.csrf, 'storage.migrationStart'),
    async (req, res) => {
      const { target } = validBody<StorageMigrationStartRequest>(req);
      const { migration } = await startMigration(ctx, {
        target,
        startedBy: req.auth!.user.id,
        ipHash: ctx.ipHashOf(req),
      });
      sendJson(res, 'storage.migrationStart', 202, { migration });
    },
  );

  router.post(
    '/admin/storage/migration/cancel',
    ...endpointGuards(ctx.csrf, 'storage.migrationCancel'),
    (req, res) => {
      const migration = cancelMigration(ctx, {
        actorId: req.auth!.user.id,
        ipHash: ctx.ipHashOf(req),
      });
      sendJson(res, 'storage.migrationCancel', 200, { migration });
    },
  );

  return router;
}
