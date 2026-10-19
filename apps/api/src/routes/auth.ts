import { Router } from 'express';
import type {
  Login2faRequest,
  LoginRecoveryRequest,
  LoginRequest,
  PasswordResetConfirm,
  PasswordResetRequest,
} from '@easysend/shared';
import { createLoginService } from '../auth/login.js';
import { createPasswordResetService } from '../auth/password-reset.js';
import type { AppContext } from '../context.js';
import { endpointGuards } from '../http/endpoint-guards.js';
import { toUser } from '../users/service.js';
import { sendJson, validBody } from '../http/validate.js';

/** Authentication endpoints (contract tag `auth`). Chains come from the registry via `endpointGuards`. */
export function authRouter(ctx: AppContext): Router {
  const router = Router();
  const login = createLoginService(ctx);
  const reset = createPasswordResetService(ctx);
  const guards = (id: string) => endpointGuards(ctx.csrf, id);

  router.get('/auth/csrf', (req, res) => {
    sendJson(res, 'auth.csrf', 200, { csrfToken: ctx.csrf.tokenFor(req, res) });
  });

  router.get('/auth/session', (req, res) => {
    // A pending session is not a login yet.
    if (req.auth?.level !== 'session') {
      sendJson(res, 'auth.session', 200, { authenticated: false });
      return;
    }
    sendJson(res, 'auth.session', 200, {
      authenticated: true,
      user: toUser(ctx, req.auth.user),
      csrfToken: ctx.csrf.sessionToken(req.auth.session.id),
    });
  });

  router.post('/auth/login', ...guards('auth.login'), async (req, res) => {
    sendJson(res, 'auth.login', 200, await login.login(req, res, validBody<LoginRequest>(req)));
  });

  router.post('/auth/login/2fa', ...guards('auth.login2fa'), async (req, res) => {
    sendJson(
      res,
      'auth.login2fa',
      200,
      await login.login2fa(req, res, validBody<Login2faRequest>(req)),
    );
  });

  router.post('/auth/login/recovery', ...guards('auth.loginRecovery'), async (req, res) => {
    sendJson(
      res,
      'auth.loginRecovery',
      200,
      await login.loginRecovery(req, res, validBody<LoginRecoveryRequest>(req)),
    );
  });

  router.post('/auth/login/2fa-setup', ...guards('auth.login2faSetup'), (req, res) => {
    sendJson(res, 'auth.login2faSetup', 200, login.login2faSetup(req));
  });

  router.post(
    '/auth/login/2fa-setup/verify',
    ...guards('auth.login2faSetupVerify'),
    async (req, res) => {
      sendJson(
        res,
        'auth.login2faSetupVerify',
        200,
        await login.login2faSetupVerify(req, res, validBody<Login2faRequest>(req)),
      );
    },
  );

  router.post('/auth/logout', ...guards('auth.logout'), (req, res) => {
    login.logout(req, res);
    res.status(204).end();
  });

  router.post(
    '/auth/password-reset/request',
    ...guards('auth.passwordResetRequest'),
    async (req, res) => {
      await reset.request(req, validBody<PasswordResetRequest>(req).email);
      sendJson(res, 'auth.passwordResetRequest', 202, { ok: true });
    },
  );

  router.post(
    '/auth/password-reset/confirm',
    ...guards('auth.passwordResetConfirm'),
    async (req, res) => {
      await reset.confirm(req, res, validBody<PasswordResetConfirm>(req));
      sendJson(res, 'auth.passwordResetConfirm', 200, { ok: true });
    },
  );

  return router;
}
