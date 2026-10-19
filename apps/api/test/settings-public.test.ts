import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '@easysend/shared';
import { brandingApp, makePng, makeWebp, upload } from './branding-fixtures.js';
import { bodyAs, errorCode } from './helpers.js';

const appearance = {
  instanceName: 'Acme Files',
  footer: 'Acme srl',
  primaryColor: '#112233',
  accentColor: '#445566',
  radius: 0.5,
  font: 'system',
  defaultTheme: 'dark',
};

describe('public settings and branding assets', () => {
  it('serves the defaults, then the updated appearance and assets', async () => {
    const { t, admin } = await brandingApp();
    const anon = t.client();
    const first = await anon.get('/api/public/settings');
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      setupCompleted: true,
      appMode: 'local',
      defaultLocale: 'it',
      appearance: DEFAULT_APPEARANCE,
      assets: { logoLight: null, logoDark: null, favicon: null, background: null },
    });

    const put = await admin.put('/api/admin/settings/appearance', { body: appearance });
    expect(put.status).toBe(200);
    expect(bodyAs<{ appearance: unknown }>(put).appearance).toEqual(appearance);
    const up = await upload(admin, 'logoDark', await makePng(), 'image/png');
    const after = bodyAs<{ appearance: unknown; assets: { logoDark: { updatedAt: number } } }>(
      await anon.get('/api/public/settings'),
    );
    expect(after.appearance).toEqual(appearance);
    expect(after.assets.logoDark.updatedAt).toBe(up.body.updatedAt);
  });

  it('serves an image with cache headers, ETag and 304', async () => {
    const { t, admin } = await brandingApp();
    const anon = t.client();
    await upload(admin, 'background', await makeWebp(300, 200), 'image/webp');

    const res = await anon.get('/api/assets/background');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
    const etag = res.headers.etag!;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);

    const cached = await anon.get('/api/assets/background', { headers: { 'If-None-Match': etag } });
    expect(cached.status).toBe(304);
    expect(cached.headers.etag).toBe(etag);
    const other = await anon.get('/api/assets/background', {
      headers: { 'If-None-Match': '"other"' },
    });
    expect(other.status).toBe(200);
  });

  it('answers NOT_FOUND when not set, when the file is missing and 400 for unknown kinds', async () => {
    const { t, admin } = await brandingApp();
    const anon = t.client();
    expect(errorCode(await anon.get('/api/assets/favicon'))).toBe('NOT_FOUND');
    await upload(admin, 'favicon', await makePng(), 'image/png');
    expect((await anon.get('/api/assets/favicon')).status).toBe(200);
    rmSync(path.join(t.config.brandingDir, 'favicon.png'));
    expect(errorCode(await anon.get('/api/assets/favicon'))).toBe('NOT_FOUND');
    expect((await anon.get('/api/assets/..%2Fsecret')).status).toBe(400);
    expect((await anon.get('/api/assets/emailLogo')).status).toBe(400);
  });

  it('resets appearance, images and the email logo', async () => {
    const { t, admin } = await brandingApp();
    await admin.put('/api/admin/settings/appearance', { body: appearance });
    await upload(admin, 'logoLight', await makePng(), 'image/png');
    await upload(admin, 'background', await makePng(), 'image/png');
    expect(readdirSync(t.config.brandingDir).length).toBe(3);

    const res = await admin.post('/api/admin/settings/appearance/reset');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      appearance: DEFAULT_APPEARANCE,
      assets: { logoLight: null, logoDark: null, favicon: null, background: null },
    });
    expect(readdirSync(t.config.brandingDir)).toEqual([]);
    expect(t.ctx.settings.get('branding_assets')).toBeUndefined();
    expect(t.ctx.settings.get('appearance')).toBeUndefined();
  });

  it('validates the appearance', async () => {
    const { admin } = await brandingApp();
    const bad = await admin.put('/api/admin/settings/appearance', {
      body: { ...appearance, primaryColor: 'red' },
    });
    expect(bad.status).toBe(400);
  });
});
