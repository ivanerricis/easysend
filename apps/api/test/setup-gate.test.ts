import { describe, expect, it } from 'vitest';
import { createTestApp, errorCode } from './helpers.js';

describe('setup gate', () => {
  it('blocks API routes with SETUP_REQUIRED until the setup is completed', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = t.client();

    for (const [method, url] of [
      ['get', '/api/transfers'],
      ['post', '/api/transfers'],
      ['post', '/api/auth/login'],
      ['get', '/api/me'],
      ['get', '/api/downloads/abc'],
      ['post', '/api/uploads'],
      ['get', '/api/uploads/xyz'],
      ['get', '/API/Transfers'],
      ['get', '/api/transfers/'],
    ] as const) {
      const res = await client.request(method, url, { csrf: false });
      expect(res.status, `${method} ${url}`).toBe(409);
      expect(errorCode(res), `${method} ${url}`).toBe('SETUP_REQUIRED');
      expect(res.body['error']).toMatchObject({ requestId: expect.any(String) as string });
    }
  });

  it('lets the allowed routes through', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = t.client();

    expect((await client.get('/api/health')).status).toBe(200);
    expect((await client.get('/api/auth/csrf')).status).toBe(200);
    expect((await client.get('/api/auth/session')).status).not.toBe(409);
    // Not implemented yet, but the gate must not be what answers.
    for (const url of [
      '/api/setup/status',
      '/api/setup',
      '/api/public/settings',
      '/api/assets/favicon',
    ]) {
      const res = await client.get(url);
      expect(errorCode(res), url).not.toBe('SETUP_REQUIRED');
    }
    // Only the GET of auth/csrf is exempt.
    expect(errorCode(await client.post('/api/auth/csrf', { csrf: false }))).toBe('SETUP_REQUIRED');
  });

  it('lets everything through once the setup is completed, and keeps doing so', async () => {
    const t = await createTestApp({ setupCompleted: false });
    const client = t.client();
    expect(errorCode(await client.get('/api/transfers'))).toBe('SETUP_REQUIRED');

    t.ctx.settings.set('setup_completed', true);
    expect(errorCode(await client.get('/api/transfers'))).toBe('UNAUTHENTICATED');

    // Completion is cached: it does not flip back.
    t.ctx.settings.delete('setup_completed');
    expect(errorCode(await client.get('/api/transfers'))).toBe('UNAUTHENTICATED');
  });

  it('is open by default in the test app', async () => {
    const t = await createTestApp();
    expect(errorCode(await t.client().get('/api/transfers'))).toBe('UNAUTHENTICATED');
  });
});
