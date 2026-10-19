import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requireAuth } from '../src/auth/guards.js';
import { createAuthLimiters } from '../src/auth/limiters.js';
import type { AuthContext } from '../src/auth/session.js';
import { clearCookie, cookieParser, setCookie } from '../src/http/cookies.js';
import { createClientIpResolver, ipHash } from '../src/http/client-ip.js';
import { endpointGuards } from '../src/http/endpoint-guards.js';
import { createErrorHandler } from '../src/http/error-handler.js';
import { createLimiter, rateLimit } from '../src/http/rate-limit.js';
import { requestId } from '../src/http/request-id.js';
import { getEndpoint, sendJson, validBody, validate } from '../src/http/validate.js';
import { createCsrf } from '../src/http/csrf.js';
import { deriveKeys } from '../src/crypto/keys.js';
import { TEST_SECRETS, silentLogger } from './helpers.js';

const withErrors = (app: express.Express) => {
  app.use(createErrorHandler(silentLogger));
  return app;
};
const errorCode = (body: unknown) => (body as { error: { code: string } }).error.code;

describe('cookies', () => {
  it('sets HttpOnly, Secure, SameSite=Lax, Path=/ and Max-Age, keeping other cookies', async () => {
    const app = express();
    app.get('/', (_req, res) => {
      setCookie(res, 'es_session', 'abc', 3600.9);
      setCookie(res, 'es_csrf', 'def', 60);
      clearCookie(res, 'old');
      res.end();
    });
    const res = await request(app).get('/');
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies).toHaveLength(3);
    const [session, , cleared] = cookies as [string, string, string];
    for (const attr of [
      'es_session=abc',
      'Max-Age=3600',
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
    ]) {
      expect(session).toContain(attr);
    }
    expect(cleared).toContain('Max-Age=0');
  });

  it('parses the Cookie header into req.cookies', async () => {
    const app = express();
    app.use(cookieParser);
    app.get('/', (req, res) => {
      res.json(req.cookies);
    });
    const res = await request(app).get('/').set('Cookie', 'a=1; b=two%20words');
    expect(res.body).toEqual({ a: '1', b: 'two words' });
    expect((await request(app).get('/')).body).toEqual({});
  });
});

const ipOf = (res: { body: unknown }) => (res.body as { ip: string }).ip;

describe('client IP', () => {
  const echo = (config: { mode: 'local' | 'production'; trustProxy: number }) => {
    const resolve = createClientIpResolver(config);
    const app = express();
    app.set('trust proxy', config.trustProxy);
    app.get('/', (req, res) => {
      res.json({ ip: resolve(req) });
    });
    return app;
  };

  it('ignores CF-Connecting-IP in local mode', async () => {
    const res = await request(echo({ mode: 'local', trustProxy: 1 }))
      .get('/')
      .set('X-Forwarded-For', '198.51.100.7')
      .set('CF-Connecting-IP', '203.0.113.5');
    expect(ipOf(res)).toBe('198.51.100.7');
  });

  it('uses CF-Connecting-IP in production when the proxy chain is complete', async () => {
    const res = await request(echo({ mode: 'production', trustProxy: 2 }))
      .get('/')
      .set('X-Forwarded-For', '198.51.100.7, 10.1.1.1')
      .set('CF-Connecting-IP', '203.0.113.5');
    expect(ipOf(res)).toBe('203.0.113.5');
  });

  it('falls back to req.ip without the header, with a bad header, or with a short chain', async () => {
    const app = echo({ mode: 'production', trustProxy: 2 });
    const withoutHeader = await request(app)
      .get('/')
      .set('X-Forwarded-For', '198.51.100.7, 10.1.1.1');
    expect(ipOf(withoutHeader)).toBe('198.51.100.7');

    const garbage = await request(app)
      .get('/')
      .set('X-Forwarded-For', '198.51.100.7, 10.1.1.1')
      .set('CF-Connecting-IP', 'not-an-ip');
    expect(ipOf(garbage)).toBe('198.51.100.7');

    // Direct hit that did not cross the proxies: a forged header must not be trusted.
    const direct = await request(app).get('/').set('CF-Connecting-IP', '203.0.113.5');
    expect(ipOf(direct)).toMatch(/127.0.0.1$/);
  });

  it('hashes addresses with a keyed HMAC', () => {
    const key = deriveKeys(TEST_SECRETS).ipHash;
    expect(ipHash(key, '203.0.113.5')).toBe(ipHash(key, '203.0.113.5'));
    expect(ipHash(key, '203.0.113.5')).not.toBe(ipHash(key, '203.0.113.6'));
    expect(ipHash(key, '203.0.113.5')).not.toContain('203');
  });
});

describe('rate limiter', () => {
  const policy = { points: 3, durationSeconds: 60, blockSeconds: 60 };

  it('consume: the request over the limit is refused with a retry delay', async () => {
    const limiter = createLimiter(policy);
    for (let i = 0; i < 3; i++) expect((await limiter.consume('k')).limited).toBe(false);
    const over = await limiter.consume('k');
    expect(over.limited).toBe(true);
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
    expect((await limiter.consume('other')).limited).toBe(false);
  });

  it('fail + check: locks as soon as the threshold is reached', async () => {
    const limiter = createLimiter(policy);
    expect((await limiter.fail('a')).limited).toBe(false);
    expect((await limiter.fail('a')).limited).toBe(false);
    expect((await limiter.check('a')).limited).toBe(false);
    const third = await limiter.fail('a');
    expect(third).toEqual({ limited: true, retryAfterSeconds: 60 });
    expect((await limiter.check('a')).limited).toBe(true);
    await limiter.reset('a');
    expect((await limiter.check('a')).limited).toBe(false);
  });

  it('reward and block', async () => {
    const limiter = createLimiter(policy);
    await limiter.fail('a', 2);
    await limiter.reward('a', 2);
    expect((await limiter.fail('a')).limited).toBe(false);
    await limiter.block('b', 30);
    expect((await limiter.check('b')).limited).toBe(true);
  });

  it('every createAuthLimiters call has independent state', async () => {
    const one = createAuthLimiters();
    const two = createAuthLimiters();
    for (let i = 0; i < 5; i++) await one.loginAccount.fail('a@b.c');
    expect((await one.loginAccount.check('a@b.c')).limited).toBe(true);
    expect((await two.loginAccount.check('a@b.c')).limited).toBe(false);
  });

  it('middleware answers 429 RATE_LIMITED with Retry-After', async () => {
    const limiter = createLimiter({ points: 2, durationSeconds: 60, blockSeconds: 60 });
    const app = express();
    app.use(requestId);
    app.get(
      '/',
      rateLimit(limiter, () => 'ip'),
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    withErrors(app);
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(200);
    const res = await request(app).get('/');
    expect(res.status).toBe(429);
    expect(errorCode(res.body)).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('middleware can answer ACCOUNT_LOCKED', async () => {
    const limiter = createLimiter({ points: 1, durationSeconds: 60, blockSeconds: 60 });
    const app = express();
    app.use(requestId);
    app.get(
      '/',
      rateLimit(limiter, () => 'acct', 'ACCOUNT_LOCKED'),
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    withErrors(app);
    await request(app).get('/');
    const res = await request(app).get('/');
    expect(res.status).toBe(429);
    expect(errorCode(res.body)).toBe('ACCOUNT_LOCKED');
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('auth guards', () => {
  const run = async (
    level: Parameters<typeof requireAuth>[0],
    auth?: { level: string; role?: string },
  ) => {
    const app = express();
    app.use(requestId);
    app.use((req, _res, next) => {
      if (auth) {
        req.auth = {
          session: { id: 's' },
          user: { role: auth.role ?? 'user' },
          level: auth.level,
        } as unknown as AuthContext;
      }
      next();
    });
    app.get('/', requireAuth(level), (_req, res) => {
      res.json({ ok: true });
    });
    withErrors(app);
    const res = await request(app).get('/');
    return res.status === 200 ? 'ok' : errorCode(res.body);
  };

  it('session: needs a full session', async () => {
    expect(await run('session')).toBe('UNAUTHENTICATED');
    expect(await run('session', { level: 'mfa-pending' })).toBe('UNAUTHENTICATED');
    expect(await run('session', { level: 'session' })).toBe('ok');
  });

  it('mfa-pending: only a pending session', async () => {
    expect(await run('mfa-pending')).toBe('UNAUTHENTICATED');
    expect(await run('mfa-pending', { level: 'session' })).toBe('UNAUTHENTICATED');
    expect(await run('mfa-pending', { level: 'mfa-pending' })).toBe('ok');
  });

  it('admin: full session with the admin role', async () => {
    expect(await run('admin', { level: 'session' })).toBe('FORBIDDEN');
    expect(await run('admin', { level: 'mfa-pending', role: 'admin' })).toBe('UNAUTHENTICATED');
    expect(await run('admin', { level: 'session', role: 'admin' })).toBe('ok');
  });

  it('any: pending or full, never anonymous', async () => {
    expect(await run('any')).toBe('UNAUTHENTICATED');
    expect(await run('any', { level: 'mfa-pending' })).toBe('ok');
    expect(await run('any', { level: 'session' })).toBe('ok');
  });
});

describe('validate, sendJson and endpointGuards', () => {
  it('looks endpoints up by id and fails fast on unknown ids', () => {
    expect(getEndpoint('auth.login').path).toBe('/api/auth/login');
    expect(() => getEndpoint('nope.nothing')).toThrow(/Unknown endpoint/);
    expect(() => validate('nope.nothing')).toThrow();
  });

  it('parses the body with the registry schema and stores it in req.valid', async () => {
    const app = express();
    app.use(requestId, express.json());
    app.post('/login', validate('auth.login'), (req, res) => {
      res.json(validBody(req));
    });
    withErrors(app);

    const ok = await request(app).post('/login').send({ email: 'a@b.co', password: 'x', extra: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ email: 'a@b.co', password: 'x' });

    const bad = await request(app).post('/login').send({ email: 'nope' });
    expect(bad.status).toBe(400);
    expect(errorCode(bad.body)).toBe('VALIDATION_ERROR');
  });

  it('sendJson drops unlisted fields and rejects payloads that break the contract', async () => {
    const app = express();
    app.use(requestId);
    app.get('/leak', (_req, res) => {
      sendJson(res, 'auth.csrf', 200, { csrfToken: 'x'.repeat(20), passwordHash: 'secret' });
    });
    app.get('/broken', (_req, res) => {
      sendJson(res, 'auth.csrf', 200, { csrfToken: 1 });
    });
    withErrors(app);

    const leak = await request(app).get('/leak');
    expect(leak.body).toEqual({ csrfToken: 'x'.repeat(20) });
    const broken = await request(app).get('/broken');
    expect(broken.status).toBe(500);
    expect(errorCode(broken.body)).toBe('INTERNAL_ERROR');
  });

  it('endpointGuards chains auth, CSRF and validation from the contract', async () => {
    const csrf = createCsrf({
      config: { publicUrl: undefined },
      csrfKey: deriveKeys(TEST_SECRETS).csrf,
    });
    expect(endpointGuards(csrf, 'auth.csrf')).toHaveLength(0); // public, safe, no input
    expect(endpointGuards(csrf, 'auth.login')).toHaveLength(2); // csrf + validate
    expect(endpointGuards(csrf, 'me.password')).toHaveLength(3); // auth + csrf + validate
    expect(endpointGuards(csrf, 'auth.logout')).toHaveLength(2); // any-auth + csrf
    expect(() => endpointGuards(csrf, 'setup.admin')).toThrow(/phase 4/);

    const app = express();
    app.use(requestId, express.json(), cookieParser);
    app.post('/logout', ...endpointGuards(csrf, 'auth.logout'), (_req, res) => {
      res.json({ ok: true });
    });
    withErrors(app);
    const res = await request(app).post('/logout');
    expect(errorCode(res.body)).toBe('UNAUTHENTICATED');
  });
});
