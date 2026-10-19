import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createTestApp, type TestApp, type TestClient } from './helpers.js';
import { loginAs } from './session-helpers.js';

const canvas = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  });

export const makePng = (width = 100, height = 50) => canvas(width, height).png().toBuffer();
export const makeWebp = (width = 100, height = 50) => canvas(width, height).webp().toBuffer();
export const makeJpeg = (width = 100, height = 50) => canvas(width, height).jpeg().toBuffer();

/** JPEG of width x height with EXIF orientation 6 (rotate 90 degrees) and other EXIF data. */
export const makeJpegWithExif = (width: number, height: number) =>
  canvas(width, height)
    .jpeg()
    .withExif({ IFD0: { Copyright: 'secret-owner' }, IFD3: { GPSLatitudeRef: 'N' } })
    .withMetadata({ orientation: 6 })
    .toBuffer();

/** PNG header declaring a huge canvas: the pixel limit must reject it before any decode. */
export function makeHugePngHeader(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IHDR'),
    ihdr,
    randomBytes(4),
  ]);
}

export interface BrandingFixture {
  t: TestApp;
  admin: TestClient;
  adminEmail: string;
}

export async function brandingApp(): Promise<BrandingFixture> {
  const t = await createTestApp();
  const user = await t.createUser({ role: 'admin', totp: true });
  return { t, admin: loginAs(t, user), adminEmail: user.email };
}

export const uploadUrl = (kind: string) => `/api/admin/settings/appearance/assets/${kind}`;

export const upload = (admin: TestClient, kind: string, body: Buffer, contentType: string) =>
  admin.post(uploadUrl(kind), { body, headers: { 'Content-Type': contentType } });
