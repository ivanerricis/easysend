import sharp from 'sharp';
import type { AllowedImageType, BrandingAssetKind } from '@easysend/shared';
import { AppError } from '../http/errors.js';

// Image work is CPU and memory heavy: no libvips cache and one thread keep the footprint small.
sharp.cache(false);
sharp.concurrency(1);

/** Decoded pixel limit (a 2 MiB file can still declare a huge canvas). */
const MAX_INPUT_PIXELS = 25_000_000;

/** Maximum size (width x height) of each kind after processing. */
export const MAX_DIMENSIONS: Record<BrandingAssetKind, { width: number; height: number }> = {
  logoLight: { width: 800, height: 200 },
  logoDark: { width: 800, height: 200 },
  favicon: { width: 256, height: 256 },
  background: { width: 2560, height: 1440 },
};

export const EMAIL_LOGO_DIMENSIONS = { width: 480, height: 120 } as const;

export const EXTENSIONS: Record<AllowedImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const FORMAT_OF: Record<AllowedImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const invalid = () =>
  new AppError('INVALID_IMAGE', 'The file is not a valid PNG, JPEG or WebP image');

/** True when the leading bytes are the signature of `type`. */
export function matchesMagicBytes(buffer: Buffer, type: AllowedImageType): boolean {
  switch (type) {
    case 'image/png':
      return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
    case 'image/jpeg':
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/webp':
      return (
        buffer.length >= 12 &&
        buffer.toString('latin1', 0, 4) === 'RIFF' &&
        buffer.toString('latin1', 8, 12) === 'WEBP'
      );
  }
}

const decodeOptions = { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' } as const;

export interface ProcessedImage {
  content: Buffer;
  contentType: AllowedImageType;
  extension: string;
}

/**
 * Validates and re-encodes an uploaded image: magic bytes must match the declared type, EXIF
 * orientation is applied, the size is capped for the kind, and every other metadata block is
 * dropped by the re-encode. Any decode failure is `INVALID_IMAGE`.
 */
export async function processBrandingImage(
  kind: BrandingAssetKind,
  input: Buffer,
  declared: AllowedImageType,
): Promise<ProcessedImage> {
  if (!matchesMagicBytes(input, declared)) throw invalid();
  const { width, height } = MAX_DIMENSIONS[kind];
  try {
    const meta = await sharp(input, decodeOptions).metadata();
    if (meta.format !== FORMAT_OF[declared]) throw invalid();

    const base = sharp(input, decodeOptions).rotate();
    if (kind === 'favicon') {
      const content = await base
        .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer();
      return { content, contentType: 'image/png', extension: 'png' };
    }
    const resized = base.resize(width, height, { fit: 'inside', withoutEnlargement: true });
    const encoded =
      declared === 'image/png'
        ? resized.png({ compressionLevel: 9 })
        : declared === 'image/jpeg'
          ? resized.jpeg({ quality: 85, mozjpeg: true })
          : resized.webp({ quality: 85 });
    return {
      content: await encoded.toBuffer(),
      contentType: declared,
      extension: EXTENSIONS[declared],
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalid();
  }
}

/** PNG rendition of the light logo for emails (at most 480x120, never enlarged). */
export async function renderEmailLogo(input: Buffer): Promise<Buffer> {
  try {
    return await sharp(input, decodeOptions)
      .rotate()
      .resize(EMAIL_LOGO_DIMENSIONS.width, EMAIL_LOGO_DIMENSIONS.height, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    throw invalid();
  }
}
