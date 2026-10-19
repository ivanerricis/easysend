import { asc, count, eq } from 'drizzle-orm';
import { Router } from 'express';
import type {
  SetupAdminRequest,
  SetupAdminVerifyRequest,
  SetupCodeRequest,
  SetupGeneralRequest,
  SmtpSettings,
  SmtpSettingsPublic,
} from '@easysend/shared';
import { audit, type AuditAction } from '../audit.js';
import { tunnelHandler } from '../cloudflare/handler.js';
import { generateTotpEnrollment, verifyTotp } from '../auth/totp.js';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { encryptSecret } from '../crypto/aead.js';
import { users } from '../db/schema/index.js';
import { endpointGuards } from '../http/endpoint-guards.js';
import { AppError } from '../http/errors.js';
import { assertNotLimited } from '../http/rate-limit.js';
import { sendJson, validBody } from '../http/validate.js';
import { saveVerifiedSmtpSettings, testSmtpSettings, toSmtpPublic } from '../settings/smtp.js';
import { clearSetupCookie, hasValidSetupCookie, setSetupCookie } from '../setup/cookie.js';
import { setupEndpointGuards } from '../setup/guard.js';
import { normalizeEmail, replaceRecoveryCodes, toUser } from '../users/service.js';

/** First-run wizard endpoints (`setup.*`); the Cloudflare step shares its handler with `admin.tunnelSet`. */
export function setupRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, clock, settings } = ctx;
  const guards = (id: string) => setupEndpointGuards(ctx, id);
  const isLocal = ctx.config.mode === 'local';

  const adminExists = (): boolean =>
    (db.select({ n: count() }).from(users).where(eq(users.role, 'admin')).get()?.n ?? 0) > 0;

  const record = (
    req: Parameters<AppContext['ipHashOf']>[0],
    action: AuditAction,
    actorId: string | null,
  ): void => {
    audit(db, {
      actorId,
      action,
      targetType: 'settings',
      ipHash: ctx.ipHashOf(req),
      now: nowSeconds(clock),
    });
  };

  const steps = () => ({
    admin: adminExists(),
    smtp: settings.get('smtp') !== undefined,
    // `configuredAt` 0 marks a tunnel created by an attempt that did not finish.
    cloudflare: isLocal || (settings.get('tunnel')?.configuredAt ?? 0) > 0,
    general: settings.get('general') !== undefined,
  });

  router.get('/setup/status', (req, res) => {
    sendJson(res, 'setup.status', 200, {
      setupCompleted: settings.isSetupCompleted(),
      appMode: ctx.config.mode,
      codeVerified: hasValidSetupCookie(ctx, req),
      steps: steps(),
    });
  });

  router.post('/setup/code', ...endpointGuards(ctx.csrf, 'setup.code'), async (req, res) => {
    if (settings.isSetupCompleted()) {
      throw new AppError('SETUP_ALREADY_COMPLETED', 'The setup is already completed');
    }
    const ipKey = ctx.ipHashOf(req);
    const { setupCodeIp, setupCodeGlobal } = ctx.setupLimiters;
    assertNotLimited(res, await setupCodeIp.check(ipKey));
    assertNotLimited(res, await setupCodeGlobal.check('global'));

    const result = ctx.setupCode.verify(validBody<SetupCodeRequest>(req).code);
    if (result === 'expired') {
      throw new AppError('SETUP_CODE_EXPIRED', 'The setup code expired: a new one is in the logs');
    }
    if (result === 'invalid') {
      const ip = await setupCodeIp.fail(ipKey);
      const global = await setupCodeGlobal.fail('global');
      assertNotLimited(res, ip);
      assertNotLimited(res, global);
      throw new AppError('SETUP_CODE_INVALID', 'Wrong setup code');
    }
    setSetupCookie(ctx, res);
    sendJson(res, 'setup.code', 200, { ok: true });
  });

  router.post('/setup/admin', ...guards('setup.admin'), async (req, res) => {
    const body = validBody<SetupAdminRequest>(req);
    if (adminExists()) throw new AppError('CONFLICT', 'An admin already exists');
    const email = normalizeEmail(body.email);
    const enrollment = generateTotpEnrollment({ email, issuer: settings.getInstanceName() });
    const displayName = body.displayName?.trim();
    settings.set('setup_admin_pending', {
      email,
      displayName: displayName ? displayName : null,
      passwordHash: await ctx.passwordHasher.hash(body.password),
      totpSecret: enrollment.secret,
      createdAt: nowSeconds(clock),
    });
    sendJson(res, 'setup.admin', 200, enrollment);
  });

  router.post('/setup/admin/verify', ...guards('setup.adminVerify'), async (req, res) => {
    const { code } = validBody<SetupAdminVerifyRequest>(req);
    const pending = settings.get('setup_admin_pending');
    if (!pending) throw new AppError('CONFLICT', 'Start the admin creation first');
    if (adminExists()) throw new AppError('CONFLICT', 'An admin already exists');
    if (db.select({ id: users.id }).from(users).where(eq(users.email, pending.email)).get()) {
      throw new AppError('CONFLICT', 'The email is already in use');
    }

    const ipKey = ctx.ipHashOf(req);
    assertNotLimited(res, await ctx.setupLimiters.setupCodeIp.check(ipKey));
    const match = verifyTotp({
      secret: pending.totpSecret,
      code,
      nowMs: clock(),
      lastCounter: null,
    });
    if (!match) {
      assertNotLimited(res, await ctx.setupLimiters.setupCodeIp.fail(ipKey));
      throw new AppError('INVALID_TOTP_CODE', 'Wrong or expired code');
    }

    const { row, recoveryCodes } = db.transaction((tx) => {
      const created = tx
        .insert(users)
        .values({
          email: pending.email,
          displayName: pending.displayName,
          passwordHash: pending.passwordHash,
          role: 'admin',
          totpSecretEnc: encryptSecret(ctx.keys.totp, 'totp', pending.totpSecret),
          totpEnabled: true,
          totpLastCounter: match.counter,
          locale: null,
          createdAt: nowSeconds(clock),
        })
        .returning()
        .get();
      const codes = replaceRecoveryCodes(ctx, tx, created.id);
      settings.delete('setup_admin_pending');
      audit(tx, {
        actorId: created.id,
        action: 'setup.admin_created',
        targetType: 'user',
        targetId: created.id,
        ipHash: ipKey,
        now: nowSeconds(clock),
      });
      return { row: created, recoveryCodes: codes };
    });

    const { session } = ctx.sessions.start(req, res, { userId: row.id, mfaVerified: true });
    sendJson(res, 'setup.adminVerify', 201, {
      user: toUser(ctx, row),
      csrfToken: ctx.csrf.sessionToken(session.id),
      recoveryCodes,
    });
  });

  router.get('/setup/smtp', ...guards('setup.smtpGet'), (_req, res) => {
    const stored = settings.get('smtp');
    if (stored) {
      sendJson(res, 'setup.smtpGet', 200, { smtp: toSmtpPublic(stored), verified: true });
      return;
    }
    const suggestion: SmtpSettingsPublic = isLocal
      ? {
          host: ctx.config.smtpDevHost ?? 'mailpit',
          port: ctx.config.smtpDevPort ?? 1025,
          security: 'none',
          fromEmail: 'no-reply@localhost.localdomain',
          fromName: settings.getInstanceName(),
          hasPassword: false,
        }
      : {
          host: 'smtp.example.com',
          port: 587,
          security: 'starttls',
          fromEmail: 'no-reply@example.com',
          fromName: settings.getInstanceName(),
          hasPassword: false,
        };
    sendJson(res, 'setup.smtpGet', 200, { smtp: suggestion, verified: false });
  });

  router.post('/setup/smtp/test', ...guards('setup.smtpTest'), async (req, res) => {
    const admin = db
      .select()
      .from(users)
      .where(eq(users.role, 'admin'))
      .orderBy(asc(users.createdAt))
      .get();
    if (!admin) throw new AppError('CONFLICT', 'Create the admin first');
    assertNotLimited(res, await ctx.setupLimiters.smtpTest.consume('setup'));
    await testSmtpSettings(ctx, validBody<SmtpSettings>(req), admin.email, admin.locale);
    sendJson(res, 'setup.smtpTest', 200, { ok: true, sentTo: admin.email });
  });

  router.put('/setup/smtp', ...guards('setup.smtpSave'), (req, res) => {
    const saved = saveVerifiedSmtpSettings(ctx, validBody<SmtpSettings>(req));
    record(req, 'setup.smtp_saved', req.auth?.user.id ?? null);
    sendJson(res, 'setup.smtpSave', 200, saved);
  });

  router.put('/setup/general', ...guards('setup.general'), (req, res) => {
    const { instanceName, defaultTheme, ...general } = validBody<SetupGeneralRequest>(req);
    settings.set('general', general);
    settings.set('appearance', { ...settings.getAppearance(), instanceName, defaultTheme });
    record(req, 'setup.general_saved', req.auth?.user.id ?? null);
    sendJson(res, 'setup.general', 200, { ok: true });
  });

  router.post(
    '/setup/cloudflare',
    ...guards('setup.cloudflare'),
    tunnelHandler(ctx, 'setup.cloudflare'),
  );

  router.post('/setup/complete', ...guards('setup.complete'), (req, res) => {
    const done = steps();
    const missing = (['admin', 'smtp', 'cloudflare', 'general'] as const).filter((s) => !done[s]);
    if (missing.length > 0) {
      throw new AppError('CONFLICT', 'Some setup steps are not done', { missing });
    }
    settings.set('setup_completed', true);
    settings.delete('setup_admin_pending');
    clearSetupCookie(res);
    record(req, 'setup.completed', req.auth?.user.id ?? null);
    sendJson(res, 'setup.complete', 200, { ok: true });
  });

  return router;
}
