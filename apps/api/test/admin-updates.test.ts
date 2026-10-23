import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { UpdateStatusResponse } from '@easysend/shared';
import { createLogger } from '../src/logger.js';
import { createUpdateService } from '../src/updates/service.js';
import { compareSemver, parseSemver } from '../src/updates/semver.js';
import { bodyAs, createTestApp, createTestClock, silentLogger } from './helpers.js';
import { loginAs } from './session-helpers.js';

const URL_UPDATES = '/api/admin/updates';

interface FakeRelease {
  tag_name?: string;
  html_url?: string;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

/** `fetch` stand-in for the GitHub API that records requests and can be told to fail. */
class FakeGithub {
  readonly requests: { url: string; headers: Record<string, string>; hasSignal: boolean }[] = [];
  releases: unknown[] = [
    {
      tag_name: 'v0.2.0',
      html_url: 'https://github.com/ivanerricis/easysend/releases/tag/v0.2.0',
      published_at: '2026-10-01T10:00:00Z',
      draft: false,
      prerelease: false,
    },
  ];
  /** The first (newest) release of the list. */
  get release(): FakeRelease {
    return this.releases[0] as FakeRelease;
  }
  set release(value: FakeRelease) {
    this.releases = [value];
  }
  mode: 'ok' | 'network' | 'timeout' | 'status' | 'invalid-json' | 'bad-shape' = 'ok';

  fetch: typeof fetch = (input, init) => {
    this.requests.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      hasSignal: init?.signal instanceof AbortSignal,
    });
    switch (this.mode) {
      case 'network':
        return Promise.reject(new TypeError('fetch failed'));
      case 'timeout':
        return Promise.reject(new DOMException('The operation timed out', 'TimeoutError'));
      case 'status':
        return Promise.resolve(new Response('secret body', { status: 503 }));
      case 'invalid-json':
        return Promise.resolve(new Response('<html>not json</html>', { status: 200 }));
      case 'bad-shape':
        return Promise.resolve(Response.json({ tag_name: 42 }));
      default:
        return Promise.resolve(Response.json(this.releases));
    }
  };
}

async function setup(env: Record<string, string> = { APP_VERSION: '0.1.0' }) {
  const github = new FakeGithub();
  const clock = createTestClock();
  const t = await createTestApp({ env, clock, deps: { updateFetch: github.fetch } });
  const admin = loginAs(t, await t.createUser({ role: 'admin', totp: true }));
  const get = async (query = '') => {
    const res = await admin.get(`${URL_UPDATES}${query}`);
    return { res, body: bodyAs<UpdateStatusResponse>(res) };
  };
  return { t, github, clock, admin, get };
}

describe('GET /api/admin/updates', () => {
  it('reports a newer release', async () => {
    const { github, get } = await setup();
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      enabled: true,
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      releaseUrl: 'https://github.com/ivanerricis/easysend/releases/tag/v0.2.0',
      publishedAt: Math.floor(Date.parse('2026-10-01T10:00:00Z') / 1000),
      status: 'ok',
    });
    expect(body.checkedAt).toBeTypeOf('number');
    const [request] = github.requests;
    expect(request!.url).toBe(
      'https://api.github.com/repos/ivanerricis/easysend/releases?per_page=30',
    );
    expect(request!.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'easysend/0.1.0',
    });
    expect(request!.hasSignal).toBe(true);
  });

  it('uses UPDATE_CHECK_URL when set', async () => {
    const { github, get } = await setup({
      APP_VERSION: '0.1.0',
      UPDATE_CHECK_URL: 'https://mirror.example.org/latest.json',
    });
    await get();
    expect(github.requests[0]!.url).toBe('https://mirror.example.org/latest.json');
  });

  it('says up to date when the versions are equal or the instance is newer', async () => {
    const same = await setup({ APP_VERSION: '0.2.0' });
    expect((await same.get()).body).toMatchObject({
      updateAvailable: false,
      status: 'ok',
      availableVersions: [],
    });
    const newer = await setup({ APP_VERSION: '0.10.0' });
    expect((await newer.get()).body).toMatchObject({
      updateAvailable: false,
      latestVersion: '0.2.0',
    });
  });

  it('compares numerically, not as text', async () => {
    const { github, get } = await setup({ APP_VERSION: '0.9.0' });
    github.release.tag_name = 'v0.10.0';
    expect((await get()).body.updateAvailable).toBe(true);
  });

  it.each(['local', 'e2e', '0.0.0-dev'])(
    'never reports an update when the version is "%s"',
    async (version) => {
      const { get } = await setup({ APP_VERSION: version });
      const { body } = await get();
      expect(body).toMatchObject({
        currentVersion: version,
        latestVersion: '0.2.0',
        updateAvailable: false,
        availableVersions: [],
        status: 'ok',
      });
    },
  );

  it('does not call GitHub when the check is disabled', async () => {
    const { t, github, get } = await setup();
    t.ctx.settings.set('general', {
      diskReserveMb: 1,
      chunkSizeMb: 25,
      defaultLocale: 'en',
      updateCheck: false,
    });
    const { res, body } = await get('?refresh=true');
    expect(res.status).toBe(200);
    expect(body).toEqual({
      enabled: false,
      currentVersion: '0.1.0',
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      publishedAt: null,
      checkedAt: null,
      status: 'disabled',
      availableVersions: [],
    });
    expect(github.requests).toHaveLength(0);
  });

  it('is enabled by default and for stored settings without the field', async () => {
    const { t, get } = await setup();
    t.ctx.settings.set('general', { diskReserveMb: 1, chunkSizeMb: 25, defaultLocale: 'it' });
    expect((await get()).body.enabled).toBe(true);
  });

  it.each(['network', 'timeout', 'status', 'invalid-json', 'bad-shape'] as const)(
    'answers 200 "unavailable" on %s',
    async (mode) => {
      const { github, get } = await setup();
      github.mode = mode;
      const { res, body } = await get();
      expect(res.status).toBe(200);
      expect(body).toMatchObject({
        enabled: true,
        status: 'unavailable',
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
      });
      expect(body.checkedAt).toBeTypeOf('number');
    },
  );

  it('skips drafts, pre-releases, odd tags and releases with non-https links', async () => {
    const { github, get } = await setup();
    const base = {
      tag_name: 'v0.2.0',
      html_url: 'https://github.com/ivanerricis/easysend/releases/tag/v0.2.0',
    };
    for (const patch of [
      { draft: true },
      { prerelease: true },
      { tag_name: 'nightly' },
      { tag_name: 'v0.2.0-rc.1' },
      { html_url: 'javascript:alert(1)' },
    ]) {
      github.releases = [{ ...base, ...patch }];
      const { body } = await get('?refresh=true');
      expect(body.status, JSON.stringify(patch)).toBe('ok');
      expect(body.latestVersion, JSON.stringify(patch)).toBeNull();
      expect(body.availableVersions, JSON.stringify(patch)).toEqual([]);
    }
  });

  it('lists the newer releases, newest first, and reports the highest as latest', async () => {
    const { github, get } = await setup({ APP_VERSION: '0.2.0' });
    const rel = (tag: string, at: string | null, extra: object = {}) => ({
      tag_name: tag,
      html_url: `https://github.com/ivanerricis/easysend/releases/tag/${tag}`,
      published_at: at,
      ...extra,
    });
    github.releases = [
      rel('v0.2.1', '2026-10-02T00:00:00Z'),
      rel('v0.10.0', '2026-10-05T00:00:00Z'),
      rel('v0.3.0', null),
      rel('v0.4.0-rc.1', '2026-10-04T00:00:00Z', { prerelease: true }),
      rel('v0.2.0', '2026-10-01T00:00:00Z'),
      rel('v0.1.0', '2026-09-01T00:00:00Z'),
      { garbage: true },
    ];
    const { body } = await get();
    expect(body).toMatchObject({
      latestVersion: '0.10.0',
      updateAvailable: true,
      releaseUrl: 'https://github.com/ivanerricis/easysend/releases/tag/v0.10.0',
    });
    expect(body.availableVersions.map((v) => v.version)).toEqual(['0.10.0', '0.3.0', '0.2.1']);
    expect(body.availableVersions[0]).toEqual({
      version: '0.10.0',
      releaseUrl: 'https://github.com/ivanerricis/easysend/releases/tag/v0.10.0',
      publishedAt: Math.floor(Date.parse('2026-10-05T00:00:00Z') / 1000),
    });
    expect(body.availableVersions[1]!.publishedAt).toBeNull();
  });

  it('caps the list at 30 versions', async () => {
    const { github, get } = await setup({ APP_VERSION: '0.0.1' });
    github.releases = Array.from({ length: 60 }, (_, i) => ({
      tag_name: `v1.${i}.0`,
      html_url: `https://github.com/ivanerricis/easysend/releases/tag/v1.${i}.0`,
    }));
    const { body } = await get();
    expect(body.availableVersions).toHaveLength(30);
    expect(body.availableVersions[0]!.version).toBe('1.59.0');
  });

  it('has no available versions when the running version is not a release number', async () => {
    const { get } = await setup({ APP_VERSION: 'e2e' });
    expect((await get()).body.availableVersions).toEqual([]);
  });

  it('caches the answer and refresh=true bypasses it', async () => {
    const { github, get } = await setup();
    await get();
    await get();
    expect(github.requests).toHaveLength(1);

    github.release.tag_name = 'v0.3.0';
    expect((await get()).body.latestVersion).toBe('0.2.0');
    expect((await get('?refresh=true')).body.latestVersion).toBe('0.3.0');
    expect(github.requests).toHaveLength(2);
    expect((await get()).body.latestVersion).toBe('0.3.0');
    expect(github.requests).toHaveLength(2);
  });

  it('does not log response bodies', async () => {
    const lines: string[] = [];
    const logger = createLogger(
      { logLevel: 'trace', nodeEnv: 'test', logPretty: false },
      {},
      new Writable({
        write(chunk: Buffer, _enc, cb) {
          lines.push(chunk.toString());
          cb();
        },
      }),
    );
    const github = new FakeGithub();
    github.mode = 'status';
    const t = await createTestApp({ logger, deps: { updateFetch: github.fetch } });
    const admin = loginAs(t, await t.createUser({ role: 'admin', totp: true }));
    expect((await admin.get(URL_UPDATES)).status).toBe(200);
    const log = lines.join('');
    expect(log).toContain('update check failed');
    expect(log).not.toContain('secret body');
  });

  it('shares one request between concurrent calls', async () => {
    const { github, admin } = await setup();
    await Promise.all([admin.get(URL_UPDATES), admin.get(URL_UPDATES), admin.get(URL_UPDATES)]);
    expect(github.requests).toHaveLength(1);
  });

  it('rate limits forced checks after 10 per hour', async () => {
    const { github, get } = await setup();
    for (let i = 0; i < 10; i += 1) expect((await get('?refresh=true')).res.status).toBe(200);
    const { res } = await get('?refresh=true');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(github.requests).toHaveLength(10);
    // Cached reads are not affected.
    expect((await get()).res.status).toBe(200);
  });

  it('validates the query', async () => {
    const { get } = await setup();
    expect((await get('?refresh=maybe')).res.status).toBe(400);
  });

  it('refuses non-admins and unauthenticated clients without calling GitHub', async () => {
    const { t, github } = await setup();
    const user = loginAs(t, await t.createUser({ totp: true }));
    expect((await user.get(URL_UPDATES)).status).toBe(403);
    expect((await t.client().get(URL_UPDATES)).status).toBe(401);
    expect(github.requests).toHaveLength(0);
  });
});

describe('update service cache periods', () => {
  const build = () => {
    const github = new FakeGithub();
    const clock = createTestClock();
    const service = createUpdateService({
      url: 'https://example.org/latest',
      currentVersion: '0.1.0',
      fetch: github.fetch,
      clock,
      logger: silentLogger,
    });
    const status = (refresh = false) => service.status({ enabled: true, refresh });
    return { github, clock, status };
  };

  it('keeps a success for 24 hours', async () => {
    const { github, clock, status } = build();
    await status();
    clock.advance(23 * 3600 + 59 * 60);
    await status();
    expect(github.requests).toHaveLength(1);
    clock.advance(2 * 60);
    await status();
    expect(github.requests).toHaveLength(2);
  });

  it('keeps a failure for 1 hour', async () => {
    const { github, clock, status } = build();
    github.mode = 'network';
    expect((await status()).status).toBe('unavailable');
    github.mode = 'ok';
    clock.advance(59 * 60);
    expect((await status()).status).toBe('unavailable');
    expect(github.requests).toHaveLength(1);
    clock.advance(2 * 60);
    expect((await status()).status).toBe('ok');
    expect(github.requests).toHaveLength(2);
  });

  it('retries a failure at once with refresh', async () => {
    const { github, status } = build();
    github.mode = 'timeout';
    await status();
    github.mode = 'ok';
    expect((await status(true)).status).toBe('ok');
  });
});

describe('update service isAvailable', () => {
  const build = () => {
    const github = new FakeGithub();
    const clock = createTestClock();
    const service = createUpdateService({
      url: 'https://example.org/releases',
      currentVersion: '0.1.0',
      fetch: github.fetch,
      clock,
      logger: silentLogger,
    });
    return { github, clock, service };
  };
  const tag = (v: string) => ({
    tag_name: `v${v}`,
    html_url: `https://github.com/ivanerricis/easysend/releases/tag/v${v}`,
  });

  it('answers from the cache without another request', async () => {
    const { github, service } = build();
    await service.status({ enabled: true, refresh: false });
    expect(await service.isAvailable('0.2.0', { enabled: true })).toBe(true);
    expect(github.requests).toHaveLength(1);
  });

  it('refreshes once when the version is not in the cache', async () => {
    const { github, service } = build();
    await service.status({ enabled: true, refresh: false });
    github.releases = [tag('0.3.0'), tag('0.2.0')];
    expect(await service.isAvailable('0.3.0', { enabled: true })).toBe(true);
    expect(github.requests).toHaveLength(2);
    // Unknown version: one more request, then false.
    expect(await service.isAvailable('0.9.0', { enabled: true })).toBe(false);
    expect(github.requests).toHaveLength(3);
  });

  it('fetches once when nothing is cached', async () => {
    const { github, service } = build();
    expect(await service.isAvailable('0.9.0', { enabled: true })).toBe(false);
    expect(github.requests).toHaveLength(1);
  });

  it('refuses the current version, older ones, and anything when disabled or unreachable', async () => {
    const { github, service } = build();
    github.releases = [tag('0.2.0'), tag('0.1.0'), tag('0.0.9')];
    expect(await service.isAvailable('0.1.0', { enabled: true })).toBe(false);
    expect(await service.isAvailable('0.0.9', { enabled: true })).toBe(false);
    const before = github.requests.length;
    expect(await service.isAvailable('0.2.0', { enabled: false })).toBe(false);
    expect(github.requests).toHaveLength(before);
    github.mode = 'network';
    expect(await service.isAvailable('0.5.0', { enabled: true })).toBe(false);
  });
});

describe('general settings and the update check', () => {
  it('exposes updateCheck (default true) and changes it without touching other fields', async () => {
    const { admin } = await setup();
    const first = bodyAs<{ general: Record<string, unknown> }>(
      await admin.get('/api/admin/settings'),
    );
    expect(first.general.updateCheck).toBe(true);

    const off = await admin.patch('/api/admin/settings', { body: { updateCheck: false } });
    expect(bodyAs<{ general: Record<string, unknown> }>(off).general).toMatchObject({
      updateCheck: false,
      chunkSizeMb: first.general.chunkSizeMb,
    });

    const other = await admin.patch('/api/admin/settings', { body: { diskReserveMb: 5 } });
    expect(bodyAs<{ general: Record<string, unknown> }>(other).general).toMatchObject({
      updateCheck: false,
      diskReserveMb: 5,
    });
  });
});

describe('semver helpers', () => {
  it('parses plain release numbers only', () => {
    expect(parseSemver('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseSemver('0.10.0')).toEqual([0, 10, 0]);
    for (const bad of ['local', '0.0.0-dev', '1.2', '1.2.3.4', 'v1.2.3-rc.1', '']) {
      expect(parseSemver(bad), bad).toBeNull();
    }
  });

  it('orders versions', () => {
    expect(compareSemver([0, 10, 0], [0, 9, 9])).toBeGreaterThan(0);
    expect(compareSemver([1, 0, 0], [1, 0, 0])).toBe(0);
    expect(compareSemver([0, 1, 5], [0, 2, 0])).toBeLessThan(0);
  });
});
