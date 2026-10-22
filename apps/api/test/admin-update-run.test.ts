import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { StartUpdateResponse, UpdateRunResponse, UpdateRunStatus } from '@easysend/shared';
import { auditLog } from '../src/db/schema/index.js';
import { bodyAs, createTestApp, errorCode, makeTempDir } from './helpers.js';
import { loginAs } from './session-helpers.js';

const URL_RUN = '/api/admin/updates/run';

const release = (version: string) => ({
  tag_name: `v${version}`,
  html_url: `https://github.com/ivanerricis/easysend/releases/tag/v${version}`,
  published_at: '2026-10-01T10:00:00Z',
});

/** GitHub stand-in: serves `releases` and counts requests. */
class Releases {
  list: unknown[] = [release('0.3.0'), release('0.2.0'), release('0.1.0')];
  requests = 0;
  fail = false;
  fetch: typeof fetch = () => {
    this.requests += 1;
    if (this.fail) return Promise.reject(new TypeError('fetch failed'));
    return Promise.resolve(Response.json(this.list));
  };
}

const status = (overrides: Partial<UpdateRunStatus> = {}): UpdateRunStatus => ({
  id: 'a'.repeat(32),
  targetVersion: '0.2.0',
  fromVersion: '0.1.0',
  state: 'running',
  step: 'pull',
  error: null,
  startedAt: 1000,
  updatedAt: 1000,
  finishedAt: null,
  ...overrides,
});

async function setup(env: Record<string, string> = {}, options: { runner?: boolean } = {}) {
  const updateDir = makeTempDir();
  const releases = new Releases();
  const t = await createTestApp({
    env: { APP_MODE: 'production', APP_VERSION: '0.1.0', UPDATE_DIR: updateDir, ...env },
    deps: { updateFetch: releases.fetch },
  });
  const admin = loginAs(t, await t.createUser({ role: 'admin', totp: true }));
  const now = () => Math.floor(t.clock() / 1000);
  const writeUpdateFile = (name: string, content: string) =>
    writeFile(path.join(updateDir, name), content);
  if (options.runner ?? true) {
    await writeUpdateFile('runner.json', JSON.stringify({ version: 1, installedAt: 1 }));
  }
  const getRun = async () => {
    const res = await admin.get(URL_RUN);
    return { res, body: bodyAs<UpdateRunResponse>(res) };
  };
  const start = (version = '0.2.0') => admin.post(URL_RUN, { body: { version } });
  const requestText = () => readFile(path.join(updateDir, 'request'), 'utf8');
  return { t, updateDir, releases, admin, now, writeUpdateFile, getRun, start, requestText };
}

describe('admin.updateRun and admin.updateStart: access', () => {
  it('refuses non-admins and anonymous clients on both endpoints', async () => {
    const { t, releases } = await setup();
    const user = loginAs(t, await t.createUser({ totp: true }));
    expect((await user.get(URL_RUN)).status).toBe(403);
    expect((await user.post(URL_RUN, { body: { version: '0.2.0' } })).status).toBe(403);
    expect((await t.client().get(URL_RUN)).status).toBe(401);
    expect((await t.client().post(URL_RUN, { body: { version: '0.2.0' } })).status).toBe(401);
    expect(releases.requests).toBe(0);
  });

  it('requires the CSRF token on POST', async () => {
    const { admin, updateDir } = await setup();
    const res = await admin.post(URL_RUN, { body: { version: '0.2.0' }, csrf: false });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('CSRF_INVALID');
    expect(await readdir(updateDir)).toEqual(['runner.json']);
  });

  it('validates the body', async () => {
    const { admin } = await setup();
    for (const body of [
      {},
      { version: 2 },
      { version: 'v0.2.0' },
      { version: '0.2' },
      { version: '0.2.0-rc.1' },
      { version: '1.2.3; rm -rf /' },
    ]) {
      const res = await admin.post(URL_RUN, { body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
    }
  });
});

describe('GET /api/admin/updates/run', () => {
  it('reports runner "local" in local mode', async () => {
    const { getRun } = await setup({ APP_MODE: 'local' });
    expect((await getRun()).body).toEqual({ runner: 'local', pending: null, run: null });
  });

  it('reports runner "missing" without a valid runner.json', async () => {
    const none = await setup({}, { runner: false });
    expect((await none.getRun()).body).toEqual({ runner: 'missing', pending: null, run: null });
    for (const bad of ['not json', '{}', '{"version":2,"installedAt":1}', '[]']) {
      await none.writeUpdateFile('runner.json', bad);
      expect((await none.getRun()).body.runner, bad).toBe('missing');
    }
    await none.writeUpdateFile('runner.json', JSON.stringify({ version: 1, installedAt: 5 }));
    expect((await none.getRun()).body.runner).toBe('installed');
  });

  it('treats an unreadable (directory) runner.json as missing', async () => {
    const { updateDir, getRun } = await setup({}, { runner: false });
    await mkdir(path.join(updateDir, 'runner.json'));
    expect((await getRun()).body.runner).toBe('missing');
  });

  it('returns the validated status.json', async () => {
    const { writeUpdateFile, getRun } = await setup();
    const run = status({ state: 'succeeded', step: 'done', finishedAt: 1100, updatedAt: 1100 });
    await writeUpdateFile('status.json', JSON.stringify({ ...run, secret: 'nope' }));
    const { res, body } = await getRun();
    expect(res.status).toBe(200);
    expect(body.run).toEqual(run);
    expect(JSON.stringify(res.body)).not.toContain('nope');
  });

  it('accepts a status.json with null fields', async () => {
    const { writeUpdateFile, getRun } = await setup();
    const run = status({
      id: null,
      targetVersion: null,
      fromVersion: null,
      state: 'failed',
      error: 'busy',
      step: 'starting',
      finishedAt: 1000,
    });
    await writeUpdateFile('status.json', JSON.stringify(run));
    expect((await getRun()).body.run).toEqual(run);
  });

  it('ignores a missing, malformed, oversize or invalid status.json', async () => {
    const { writeUpdateFile, getRun } = await setup();
    expect((await getRun()).body.run).toBeNull();
    await writeUpdateFile('status.json', '{ not json');
    expect((await getRun()).body.run).toBeNull();
    await writeUpdateFile('status.json', JSON.stringify({ ...status(), state: 'exploded' }));
    expect((await getRun()).body.run).toBeNull();
    await writeUpdateFile('status.json', JSON.stringify({ ...status(), pad: 'x'.repeat(5000) }));
    expect((await getRun()).body.run).toBeNull();
    await writeUpdateFile('status.json', JSON.stringify({ ...status(), step: 'rm -rf' }));
    expect((await getRun()).body.run).toBeNull();
  });

  it('computes the pending request and its stale flag with the clock', async () => {
    const { t, now, writeUpdateFile, getRun } = await setup();
    const id = 'b'.repeat(32);
    await writeUpdateFile('request', `id=${id}\nversion=0.2.0\nrequestedAt=${now()}\n`);
    expect((await getRun()).body.pending).toEqual({
      id,
      version: '0.2.0',
      requestedAt: now(),
      stale: false,
    });
    t.clock.advance(120);
    expect((await getRun()).body.pending?.stale).toBe(false);
    t.clock.advance(1);
    expect((await getRun()).body.pending?.stale).toBe(true);
  });

  it('has no pending request once a status of the same id exists', async () => {
    const { t, now, writeUpdateFile, getRun } = await setup();
    const id = 'c'.repeat(32);
    await writeUpdateFile('request', `id=${id}\nversion=0.2.0\nrequestedAt=${now()}\n`);
    t.clock.advance(600);
    await writeUpdateFile('status.json', JSON.stringify(status({ id })));
    const { body } = await getRun();
    expect(body.pending).toBeNull();
    expect(body.run?.id).toBe(id);
  });

  it('ignores a malformed request file', async () => {
    const { writeUpdateFile, getRun } = await setup();
    for (const bad of [
      'id=xyz\nversion=0.2.0\nrequestedAt=1\n',
      `id=${'b'.repeat(32)}\nversion=0.2.0\nrequestedAt=1`,
      `id=${'B'.repeat(32)}\nversion=0.2.0\nrequestedAt=1\n`,
      `id=${'b'.repeat(32)}\nversion=v0.2.0\nrequestedAt=1\n`,
      `id=${'b'.repeat(32)}\nversion=0.2.0\nrequestedAt=1\nextra=1\n`,
    ]) {
      await writeUpdateFile('request', bad);
      expect((await getRun()).body.pending, bad).toBeNull();
    }
  });

  it('reports a missing update folder as no run', async () => {
    const t2 = await createTestApp({
      env: { APP_MODE: 'production', UPDATE_DIR: path.join(makeTempDir(), 'does-not-exist') },
    });
    const admin = loginAs(t2, await t2.createUser({ role: 'admin', totp: true }));
    const res = await admin.get(URL_RUN);
    expect(res.status).toBe(200);
    expect(bodyAs<UpdateRunResponse>(res)).toEqual({ runner: 'missing', pending: null, run: null });
  });
});

describe('POST /api/admin/updates/run', () => {
  it('writes the exact request file and answers 202', async () => {
    const { updateDir, now, start, requestText } = await setup();
    const res = await start('0.2.0');
    expect(res.status).toBe(202);
    const body = bodyAs<StartUpdateResponse>(res);
    expect(body.id).toMatch(/^[0-9a-f]{32}$/);
    expect(body).toEqual({ id: body.id, version: '0.2.0', requestedAt: now() });
    expect(await requestText()).toBe(`id=${body.id}\nversion=0.2.0\nrequestedAt=${now()}\n`);
    if (process.platform !== 'win32') {
      expect((await stat(path.join(updateDir, 'request'))).mode & 0o777).toBe(0o640);
    }
  });

  it('leaves no temporary files behind', async () => {
    const { updateDir, start } = await setup();
    await start('0.2.0');
    expect((await readdir(updateDir)).sort()).toEqual(['request', 'runner.json']);
  });

  it('accepts the newest and an intermediate version', async () => {
    const { start } = await setup();
    expect((await start('0.3.0')).status).toBe(202);
  });

  it('is refused in local mode before anything else', async () => {
    const { start, releases } = await setup({ APP_MODE: 'local' });
    const res = await start();
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('NOT_APPLICABLE_IN_LOCAL_MODE');
    expect(releases.requests).toBe(0);
  });

  it('is refused without the runner', async () => {
    const { start, updateDir, releases } = await setup({}, { runner: false });
    const res = await start();
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('UPDATE_RUNNER_MISSING');
    expect(await readdir(updateDir)).toEqual([]);
    expect(releases.requests).toBe(0);
  });

  it('is refused while a fresh request waits, and replaces a stale one', async () => {
    const { t, start, requestText } = await setup();
    const first = bodyAs<StartUpdateResponse>(await start('0.2.0'));
    t.clock.advance(60);
    const busy = await start('0.3.0');
    expect(busy.status).toBe(409);
    expect(errorCode(busy)).toBe('UPDATE_IN_PROGRESS');
    expect(await requestText()).toContain(`id=${first.id}`);

    t.clock.advance(61); // 121 s after the request: stale
    const replaced = await start('0.3.0');
    expect(replaced.status).toBe(202);
    const second = bodyAs<StartUpdateResponse>(replaced);
    expect(second.id).not.toBe(first.id);
    expect(await requestText()).toContain(`id=${second.id}\nversion=0.3.0`);
  });

  it('is refused while a run is in progress, and allowed after it ended or went silent', async () => {
    const { t, now, writeUpdateFile, start } = await setup();
    await writeUpdateFile('status.json', JSON.stringify(status({ updatedAt: now() })));
    t.clock.advance(44 * 60);
    expect(errorCode(await start())).toBe('UPDATE_IN_PROGRESS');
    t.clock.advance(2 * 60); // 46 min without news: dead run
    expect((await start()).status).toBe(202);

    const other = await setup();
    await other.writeUpdateFile(
      'status.json',
      JSON.stringify(
        status({
          state: 'rolled_back',
          step: 'done',
          error: 'deploy',
          updatedAt: other.now(),
          finishedAt: other.now(),
        }),
      ),
    );
    expect((await other.start()).status).toBe(202);
  });

  it('allows a new update when the request of a finished run is still in the folder', async () => {
    const { now, writeUpdateFile, start } = await setup();
    const id = 'd'.repeat(32);
    await writeUpdateFile('request', `id=${id}\nversion=0.2.0\nrequestedAt=${now()}\n`);
    await writeUpdateFile(
      'status.json',
      JSON.stringify(
        status({ id, state: 'succeeded', step: 'done', updatedAt: now(), finishedAt: now() }),
      ),
    );
    expect((await start()).status).toBe(202);
  });

  it('refuses unknown versions, downgrades and the current version', async () => {
    const { start, updateDir } = await setup();
    for (const version of ['0.9.0', '0.1.0', '0.0.9', '9.9.9']) {
      const res = await start(version);
      expect(res.status, version).toBe(422);
      expect(errorCode(res), version).toBe('UPDATE_VERSION_NOT_AVAILABLE');
    }
    expect(await readdir(updateDir)).toEqual(['runner.json']);
  });

  it('refuses everything when the running version is not a release number', async () => {
    const { start } = await setup({ APP_VERSION: 'e2e' });
    expect(errorCode(await start('0.2.0'))).toBe('UPDATE_VERSION_NOT_AVAILABLE');
  });

  it('refuses when the update check is disabled, without asking GitHub', async () => {
    const { t, releases, start } = await setup();
    t.ctx.settings.set('general', {
      diskReserveMb: 1,
      chunkSizeMb: 25,
      defaultLocale: 'en',
      updateCheck: false,
    });
    expect(errorCode(await start())).toBe('UPDATE_VERSION_NOT_AVAILABLE');
    expect(releases.requests).toBe(0);
  });

  it('refreshes the release list once when the version is not cached', async () => {
    const { releases, admin, start } = await setup();
    await admin.get('/api/admin/updates'); // fills the cache with 0.3.0 as newest
    expect(releases.requests).toBe(1);
    releases.list = [release('0.4.0'), ...releases.list];
    const res = await start('0.4.0');
    expect(res.status).toBe(202);
    expect(releases.requests).toBe(2);
    // A cached version needs no request at all.
    const again = await setup();
    await again.admin.get('/api/admin/updates');
    expect((await again.start('0.2.0')).status).toBe(202);
    expect(again.releases.requests).toBe(1);
  });

  it('refuses when GitHub cannot be reached', async () => {
    const { releases, start } = await setup();
    releases.fail = true;
    expect(errorCode(await start('0.2.0'))).toBe('UPDATE_VERSION_NOT_AVAILABLE');
  });

  it('records an audit row without secrets', async () => {
    const { t, admin, start } = await setup();
    const me = bodyAs<{ user: { id: string } }>(await admin.get('/api/auth/session')).user.id;
    expect((await start('0.3.0')).status).toBe(202);
    const rows = t.db.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'system.update_requested'))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: me,
      targetType: 'system',
      metadata: { from: '0.1.0', to: '0.3.0' },
    });
    expect(rows[0]!.ipHash).toMatch(/^[\w-]{20,}$/);
    expect(rows[0]!.createdAt).toBe(Math.floor(t.clock() / 1000));
  });

  it('does not audit a refused request', async () => {
    const { t, start } = await setup();
    await start('0.9.0');
    expect(
      t.db.sqlite
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'system.update_requested'")
        .get(),
    ).toEqual({ n: 0 });
  });

  it('answers 500 INTERNAL_ERROR when the request cannot be written', async () => {
    const { updateDir, start } = await setup();
    // A directory named "request" makes the final rename fail.
    await mkdir(path.join(updateDir, 'request', 'sub'), { recursive: true });
    const res = await start();
    expect(res.status).toBe(500);
    expect(errorCode(res)).toBe('INTERNAL_ERROR');
    expect((await readdir(updateDir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('rate limits to 5 requests per hour', async () => {
    const { t, start } = await setup();
    for (let i = 0; i < 5; i += 1) {
      expect((await start('0.2.0')).status, `request ${i + 1}`).toBe(202);
      t.clock.advance(121); // let the pending request go stale
    }
    const res = await start('0.2.0');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(errorCode(res)).toBe('RATE_LIMITED');
  });

  it('does not count cheap refusals against the limit', async () => {
    const { start } = await setup({}, { runner: false });
    for (let i = 0; i < 8; i += 1) expect((await start()).status).toBe(409);
  });
});
