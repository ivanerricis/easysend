import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { BRANDING_MAX_BYTES } from '@easysend/shared';
import { readEmailLogo } from '../src/branding/store.js';
import {
  brandingApp,
  makeHugePngHeader,
  makeJpeg,
  makeJpegWithExif,
  makePng,
  makeWebp,
  upload,
  uploadUrl,
} from './branding-fixtures.js';
import { errorCode } from './helpers.js';

const dims = async (file: string) => {
  const meta = await sharp(file).metadata();
  return [meta.width, meta.height];
};

describe('branding image upload', () => {
  it('stores each type, resizes by kind and replaces the file when the extension changes', async () => {
    const { t, admin } = await brandingApp();
    const dir = t.config.brandingDir;

    const res = await upload(admin, 'logoDark', await makePng(4000, 1000), 'image/png');
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('logoDark');
    expect(await dims(path.join(dir, 'logoDark.png'))).toEqual([800, 200]);

    expect((await upload(admin, 'logoDark', await makeJpeg(), 'image/jpeg')).status).toBe(200);
    expect(existsSync(path.join(dir, 'logoDark.png'))).toBe(false);
    expect(existsSync(path.join(dir, 'logoDark.jpg'))).toBe(true);

    const webp = await upload(admin, 'background', await makeWebp(3000, 3000), 'image/webp');
    expect(webp.status).toBe(200);
    expect(await dims(path.join(dir, 'background.webp'))).toEqual([1440, 1440]);

    // Small images are never enlarged.
    await upload(admin, 'logoLight', await makePng(100, 50), 'image/png');
    expect(await dims(path.join(dir, 'logoLight.png'))).toEqual([100, 50]);
  });

  it('turns the favicon into a 256x256 PNG whatever the input', async () => {
    const { t, admin } = await brandingApp();
    const res = await upload(admin, 'favicon', await makeJpeg(400, 100), 'image/jpeg');
    expect(res.status).toBe(200);
    const meta = await sharp(path.join(t.config.brandingDir, 'favicon.png')).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([256, 256, 'png']);
    expect(t.ctx.settings.get('branding_assets')?.favicon?.contentType).toBe('image/png');
  });

  it('applies EXIF orientation and drops the metadata', async () => {
    const { t, admin } = await brandingApp();
    const input = await makeJpegWithExif(200, 100);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const res = await upload(admin, 'background', input, 'image/jpeg');
    expect(res.status).toBe(200);
    const stored = path.join(t.config.brandingDir, 'background.jpg');
    const meta = await sharp(stored).metadata();
    expect([meta.width, meta.height]).toEqual([100, 200]);
    expect(meta.exif).toBeUndefined();
    expect((await readFile(stored)).includes('secret-owner')).toBe(false);
  });

  it('creates the email logo for the light logo only', async () => {
    const { t, admin } = await brandingApp();
    await upload(admin, 'logoDark', await makePng(), 'image/png');
    expect(await readEmailLogo(t.ctx)).toBeNull();

    await upload(admin, 'logoLight', await makeJpeg(2000, 1000), 'image/jpeg');
    const logo = await readEmailLogo(t.ctx);
    expect(logo?.contentType).toBe('image/png');
    const meta = await sharp(logo!.content).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 240, 120]);
  });

  it('rejects unsupported types, including SVG', async () => {
    const { admin } = await brandingApp();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    for (const type of ['image/svg+xml', 'text/plain', 'application/octet-stream']) {
      const res = await upload(admin, 'logoLight', svg, type);
      expect(res.status).toBe(415);
      expect(errorCode(res)).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
  });

  it('rejects bodies over the limit', async () => {
    const { admin } = await brandingApp();
    const big = Buffer.concat([await makePng(), Buffer.alloc(BRANDING_MAX_BYTES)]);
    const res = await upload(admin, 'background', big, 'image/png');
    expect(res.status).toBe(413);
    expect(errorCode(res)).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects a declared type that does not match the bytes', async () => {
    const { admin } = await brandingApp();
    const res = await upload(admin, 'logoLight', await makeJpeg(), 'image/png');
    expect(errorCode(res)).toBe('INVALID_IMAGE');
    const text = await upload(admin, 'logoLight', Buffer.from('not an image'), 'image/webp');
    expect(errorCode(text)).toBe('INVALID_IMAGE');
  });

  it('rejects corrupted data behind valid magic bytes, huge canvases and empty bodies', async () => {
    const { t, admin } = await brandingApp();
    const png = await makePng(200, 200);
    const corrupted = Buffer.concat([png.subarray(0, 40), Buffer.alloc(300, 7)]);
    const bad = await upload(admin, 'logoLight', corrupted, 'image/png');
    expect(errorCode(bad)).toBe('INVALID_IMAGE');
    const huge = makeHugePngHeader(20_000, 20_000);
    expect(errorCode(await upload(admin, 'logoLight', huge, 'image/png'))).toBe('INVALID_IMAGE');
    const empty = await upload(admin, 'logoLight', Buffer.alloc(0), 'image/png');
    expect(errorCode(empty)).toBe('INVALID_IMAGE');
    expect(t.ctx.settings.get('branding_assets')).toBeUndefined();
    const dir = t.config.brandingDir;
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it('rejects unknown kinds', async () => {
    const { admin } = await brandingApp();
    const res = await upload(admin, 'emailLogo', await makePng(), 'image/png');
    expect(res.status).toBe(400);
  });

  it('deletes images idempotently; deleting the light logo removes the email logo', async () => {
    const { t, admin } = await brandingApp();
    const dir = t.config.brandingDir;
    await upload(admin, 'logoLight', await makePng(), 'image/png');
    expect(existsSync(path.join(dir, 'email-logo.png'))).toBe(true);

    expect((await admin.delete(uploadUrl('logoLight'))).status).toBe(204);
    expect(readdirSync(dir)).toEqual([]);
    expect(await readEmailLogo(t.ctx)).toBeNull();
    expect(t.ctx.settings.get('branding_assets')).toBeUndefined();
    expect((await admin.delete(uploadUrl('logoLight'))).status).toBe(204);
    expect((await admin.delete(uploadUrl('favicon'))).status).toBe(204);
  });

  it('writes audit rows for upload and delete', async () => {
    const { t, admin } = await brandingApp();
    await upload(admin, 'favicon', await makePng(), 'image/png');
    await admin.delete(uploadUrl('favicon'));
    const rows = t.db.sqlite
      .prepare("SELECT action FROM audit_log WHERE target_type = 'settings' ORDER BY rowid")
      .all() as { action: string }[];
    expect(rows.map((r) => r.action)).toEqual(['settings.asset_updated', 'settings.asset_deleted']);
  });
});
