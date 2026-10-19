import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorResponseSchema, healthResponseSchema } from '@easysend/shared';
import { createApp } from '../src/app.js';
import { migratedMemoryDb, silentLogger, TEST_SECRETS, testConfig } from './helpers.js';

async function makeApp() {
  const config = testConfig({ APP_VERSION: '9.9.9' });
  const db = await migratedMemoryDb();
  return { app: createApp({ config, db, logger: silentLogger, secrets: TEST_SECRETS }), db };
}

describe('GET /api/health', () => {
  it('returns a body matching the shared schema', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body).toEqual({ status: 'ok', version: '9.9.9', mode: 'local', db: 'ok' });
  });

  it('sets X-Request-Id and reuses a safe incoming id', async () => {
    const { app } = await makeApp();
    const generated = await request(app).get('/api/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const reused = await request(app).get('/api/health').set('X-Request-Id', 'client-id-12345');
    expect(reused.headers['x-request-id']).toBe('client-id-12345');

    const unsafe = await request(app).get('/api/health').set('X-Request-Id', 'bad id!');
    expect(unsafe.headers['x-request-id']).not.toBe('bad id!');
  });

  it('returns 503 with db error when the database is closed', async () => {
    const { app, db } = await makeApp();
    db.sqlite.close();
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(healthResponseSchema.parse(res.body).db).toBe('error');
  });
});

describe('error handling', () => {
  it('returns the standard 404 shape for unknown routes', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/api/nope');

    expect(res.status).toBe(404);
    const body = errorResponseSchema.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('maps malformed JSON to VALIDATION_ERROR without leaking internals', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    const body = errorResponseSchema.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/at |node_modules|stack/);
  });

  it('rejects bodies over 1 MB with PAYLOAD_TOO_LARGE', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(1_100_000) }));

    expect(res.status).toBe(413);
    expect(errorResponseSchema.parse(res.body).error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
