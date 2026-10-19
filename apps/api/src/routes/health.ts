import { Router } from 'express';
import { healthResponseSchema, type HealthResponse } from '@easysend/shared';
import type { AppConfig } from '../config.js';
import type { SqliteDatabase } from '../db/client.js';

export function healthRouter(config: Pick<AppConfig, 'version' | 'mode'>, sqlite: SqliteDatabase) {
  const router = Router();

  router.get('/health', (_req, res) => {
    let db: HealthResponse['db'] = 'ok';
    try {
      sqlite.prepare('SELECT 1').get();
    } catch {
      db = 'error';
    }
    const body = healthResponseSchema.parse({
      status: 'ok',
      version: config.version,
      mode: config.mode,
      db,
    });
    res.status(db === 'ok' ? 200 : 503).json(body);
  });

  return router;
}
