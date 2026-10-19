import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BRANDING_ASSET_KINDS,
  type AllowedImageType,
  type BrandingAssetKind,
  type BrandingAssets,
} from '@easysend/shared';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import type { BrandingAssetsSetting } from '../settings/repo.js';
import { processBrandingImage, renderEmailLogo } from './images.js';

/**
 * PNG logo embedded in emails, from the `emailLogo` entry of the `branding_assets` setting and
 * the file `brandingDir/<fileName>`. Null when it is not set or the file is missing/unreadable.
 */
export async function readEmailLogo(ctx: {
  settings: Pick<AppContext['settings'], 'get'>;
  config: Pick<AppContext['config'], 'brandingDir'>;
}): Promise<{ content: Buffer; contentType: 'image/png' } | null> {
  const entry = ctx.settings.get('branding_assets')?.emailLogo;
  if (!entry) return null;
  // The name comes from our own setting, but never let it leave the branding directory.
  if (path.basename(entry.fileName) !== entry.fileName) return null;
  try {
    const content = await readFile(path.join(ctx.config.brandingDir, entry.fileName));
    return { content, contentType: 'image/png' };
  } catch {
    return null;
  }
}

// ---- Writing -------------------------------------------------------------------------------

const EMAIL_LOGO_FILE = 'email-logo.png';

type BrandingContext = Pick<AppContext, 'settings' | 'config' | 'clock'>;

/** One branding change at a time: settings and files are updated together. */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const inBrandingDir = (ctx: Pick<AppContext, 'config'>, fileName: string): string => {
  if (path.basename(fileName) !== fileName) throw new Error('Invalid branding file name');
  return path.join(ctx.config.brandingDir, fileName);
};

async function writeAtomic(
  ctx: Pick<AppContext, 'config'>,
  fileName: string,
  content: Buffer,
): Promise<void> {
  const target = inBrandingDir(ctx, fileName);
  await mkdir(ctx.config.brandingDir, { recursive: true });
  const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, content);
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

const removeQuietly = (ctx: Pick<AppContext, 'config'>, fileName: string): Promise<void> =>
  rm(inBrandingDir(ctx, fileName), { force: true }).catch(() => undefined);

const etagOf = (content: Buffer): string =>
  createHash('sha256').update(content).digest('hex').slice(0, 32);

/** Processes and stores an uploaded image (and the email variant for the light logo). */
export function saveBrandingAsset(
  ctx: BrandingContext,
  kind: BrandingAssetKind,
  input: Buffer,
  declared: AllowedImageType,
): Promise<{ updatedAt: number }> {
  return serialized(async () => {
    const image = await processBrandingImage(kind, input, declared);
    const email = kind === 'logoLight' ? await renderEmailLogo(input) : undefined;
    const updatedAt = nowSeconds(ctx.clock);
    const current = ctx.settings.get('branding_assets') ?? {};
    const fileName = `${kind}.${image.extension}`;

    await writeAtomic(ctx, fileName, image.content);
    const next: BrandingAssetsSetting = {
      ...current,
      [kind]: { contentType: image.contentType, etag: etagOf(image.content), updatedAt, fileName },
    };
    if (email) {
      await writeAtomic(ctx, EMAIL_LOGO_FILE, email);
      next.emailLogo = { etag: etagOf(email), updatedAt, fileName: EMAIL_LOGO_FILE };
    }
    ctx.settings.set('branding_assets', next);

    const previous = current[kind]?.fileName;
    if (previous && previous !== fileName) await removeQuietly(ctx, previous);
    return { updatedAt };
  });
}

/** Removes one image (idempotent). Removing the light logo also removes the email logo. */
export function deleteBrandingAsset(ctx: BrandingContext, kind: BrandingAssetKind): Promise<void> {
  return serialized(async () => {
    const { [kind]: entry, ...rest } = ctx.settings.get('branding_assets') ?? {};
    const next: BrandingAssetsSetting = { ...rest };
    let emailFile: string | undefined;
    if (kind === 'logoLight') {
      emailFile = next.emailLogo?.fileName;
      delete next.emailLogo;
    }
    if (Object.keys(next).length === 0) ctx.settings.delete('branding_assets');
    else ctx.settings.set('branding_assets', next);
    if (entry) await removeQuietly(ctx, entry.fileName);
    if (emailFile) await removeQuietly(ctx, emailFile);
  });
}

/** Removes every branding file and the `branding_assets` setting. */
export function removeAllBranding(ctx: BrandingContext): Promise<void> {
  return serialized(async () => {
    const current = ctx.settings.get('branding_assets') ?? {};
    ctx.settings.delete('branding_assets');
    const names = [
      ...BRANDING_ASSET_KINDS.map((k) => current[k]?.fileName),
      current.emailLogo?.fileName,
    ].filter((n): n is string => n !== undefined);
    for (const name of names) await removeQuietly(ctx, name);
  });
}

/** Public view of the images: `{ updatedAt }` for each kind that is set, otherwise null. */
export function brandingAssetsView(ctx: Pick<AppContext, 'settings'>): BrandingAssets {
  const current = ctx.settings.get('branding_assets') ?? {};
  const view = (kind: BrandingAssetKind) => {
    const entry = current[kind];
    return entry ? { updatedAt: entry.updatedAt } : null;
  };
  return {
    logoLight: view('logoLight'),
    logoDark: view('logoDark'),
    favicon: view('favicon'),
    background: view('background'),
  };
}

/** File to serve for a kind, with its stored metadata; null when not set. */
export function brandingAssetFile(
  ctx: Pick<AppContext, 'settings' | 'config'>,
  kind: BrandingAssetKind,
): { filePath: string; contentType: AllowedImageType; etag: string } | null {
  const entry = ctx.settings.get('branding_assets')?.[kind];
  if (!entry || path.basename(entry.fileName) !== entry.fileName) return null;
  return {
    filePath: path.join(ctx.config.brandingDir, entry.fileName),
    contentType: entry.contentType,
    etag: entry.etag,
  };
}
