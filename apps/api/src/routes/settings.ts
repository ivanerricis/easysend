import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream';
import express, { Router, type Request } from 'express';
import {
  ALLOWED_IMAGE_TYPES,
  BRANDING_MAX_BYTES,
  DEFAULT_APPEARANCE,
  type AdminSettingsResponse,
  type AllowedImageType,
  type Appearance,
  type BrandingAssetKind,
  type GeneralSettings,
  type SmtpSettings,
  type UpdateGeneralSettingsRequest,
} from '@easysend/shared';
import { audit, type AuditAction } from '../audit.js';
import {
  brandingAssetFile,
  brandingAssetsView,
  deleteBrandingAsset,
  removeAllBranding,
  saveBrandingAsset,
} from '../branding/store.js';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { endpointGuards } from '../http/endpoint-guards.js';
import { AppError, notFound } from '../http/errors.js';
import { assertNotLimited } from '../http/rate-limit.js';
import { sendJson, validBody, validParams } from '../http/validate.js';
import { saveVerifiedSmtpSettings, testSmtpSettings, toSmtpPublic } from '../settings/smtp.js';

/** True when an `If-None-Match` header lists the strong validator `etag` (or `*`). */
function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((v) => v.trim().replace(/^W\//, ''))
    .some((v) => v === '*' || v === etag);
}

export function settingsRouter(ctx: AppContext): Router {
  const router = Router();
  const { settings } = ctx;

  const record = (req: Request, action: AuditAction, metadata?: Record<string, unknown>) =>
    audit(ctx.db, {
      actorId: req.auth?.user.id ?? null,
      action,
      targetType: 'settings',
      metadata,
      ipHash: ctx.ipHashOf(req),
      now: nowSeconds(ctx.clock),
    });

  const effectiveGeneral = (): GeneralSettings => ({
    diskReserveMb: ctx.config.defaultDiskReserveMb,
    chunkSizeMb: ctx.config.defaultChunkSizeMb,
    defaultLocale: settings.getDefaultLocale(),
    ...settings.get('general'),
  });

  const adminView = (): AdminSettingsResponse => {
    const smtp = settings.get('smtp');
    return { general: effectiveGeneral(), smtp: smtp ? toSmtpPublic(smtp) : null };
  };

  router.get('/public/settings', ...endpointGuards(ctx.csrf, 'settings.public'), (_req, res) => {
    sendJson(res, 'settings.public', 200, {
      setupCompleted: settings.isSetupCompleted(),
      appMode: ctx.config.mode,
      defaultLocale: settings.getDefaultLocale(),
      appearance: settings.getAppearance(),
      assets: brandingAssetsView(ctx),
    });
  });

  router.get('/assets/:kind', ...endpointGuards(ctx.csrf, 'settings.asset'), async (req, res) => {
    const { kind } = validParams<{ kind: BrandingAssetKind }>(req);
    const file = brandingAssetFile(ctx, kind);
    if (!file) throw notFound('Image not set');
    let size: number;
    try {
      size = (await stat(file.filePath)).size;
    } catch {
      throw notFound('Image not set');
    }
    const etag = `"${file.etag}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (etagMatches(req.get('if-none-match'), etag)) {
      res.status(304).end();
      return;
    }
    res.status(200);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(size));
    pipeline(createReadStream(file.filePath), res, (error) => {
      if (error) res.destroy();
    });
  });

  router.get('/admin/settings', ...endpointGuards(ctx.csrf, 'settings.adminGet'), (_req, res) => {
    sendJson(res, 'settings.adminGet', 200, adminView());
  });

  router.patch(
    '/admin/settings',
    ...endpointGuards(ctx.csrf, 'settings.adminUpdate'),
    (req, res) => {
      const body = validBody<UpdateGeneralSettingsRequest>(req);
      settings.set('general', { ...effectiveGeneral(), ...body });
      record(req, 'settings.general_updated', { changed: Object.keys(body) });
      sendJson(res, 'settings.adminUpdate', 200, adminView());
    },
  );

  router.post(
    '/admin/settings/smtp/test',
    ...endpointGuards(ctx.csrf, 'settings.smtpTest'),
    async (req, res) => {
      assertNotLimited(res, await ctx.setupLimiters.smtpTest.consume('admin'));
      const { user } = req.auth!;
      await testSmtpSettings(ctx, validBody<SmtpSettings>(req), user.email, user.locale);
      sendJson(res, 'settings.smtpTest', 200, { ok: true, sentTo: user.email });
    },
  );

  router.put(
    '/admin/settings/smtp',
    ...endpointGuards(ctx.csrf, 'settings.smtpSave'),
    (req, res) => {
      const view = saveVerifiedSmtpSettings(ctx, validBody<SmtpSettings>(req));
      record(req, 'settings.smtp_updated', { host: view.host, port: view.port });
      sendJson(res, 'settings.smtpSave', 200, view);
    },
  );

  router.put(
    '/admin/settings/appearance',
    ...endpointGuards(ctx.csrf, 'settings.appearanceUpdate'),
    (req, res) => {
      const appearance = validBody<Appearance>(req);
      settings.set('appearance', appearance);
      record(req, 'settings.appearance_updated');
      sendJson(res, 'settings.appearanceUpdate', 200, {
        appearance: settings.getAppearance(),
        assets: brandingAssetsView(ctx),
      });
    },
  );

  router.post(
    '/admin/settings/appearance/reset',
    ...endpointGuards(ctx.csrf, 'settings.appearanceReset'),
    async (req, res) => {
      settings.delete('appearance');
      await removeAllBranding(ctx);
      record(req, 'settings.appearance_reset');
      sendJson(res, 'settings.appearanceReset', 200, {
        appearance: DEFAULT_APPEARANCE,
        assets: brandingAssetsView(ctx),
      });
    },
  );

  router.post(
    '/admin/settings/appearance/assets/:kind',
    ...endpointGuards(ctx.csrf, 'settings.assetUpload'),
    // Only the allowed image types are buffered; any other type is rejected below without reading.
    express.raw({ type: [...ALLOWED_IMAGE_TYPES], limit: BRANDING_MAX_BYTES }),
    async (req, res) => {
      const { kind } = validParams<{ kind: BrandingAssetKind }>(req);
      const declared = (req.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(declared)) {
        throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Only PNG, JPEG and WebP images are accepted');
      }
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new AppError('INVALID_IMAGE', 'The file is empty');
      }
      const { updatedAt } = await saveBrandingAsset(ctx, kind, body, declared as AllowedImageType);
      record(req, 'settings.asset_updated', { kind });
      sendJson(res, 'settings.assetUpload', 200, { kind, updatedAt });
    },
  );

  router.delete(
    '/admin/settings/appearance/assets/:kind',
    ...endpointGuards(ctx.csrf, 'settings.assetDelete'),
    async (req, res) => {
      const { kind } = validParams<{ kind: BrandingAssetKind }>(req);
      await deleteBrandingAsset(ctx, kind);
      record(req, 'settings.asset_deleted', { kind });
      res.status(204).end();
    },
  );

  return router;
}
