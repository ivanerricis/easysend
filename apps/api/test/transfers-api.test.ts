import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type {
  ListDownloadLogsResponse,
  ListTransfersResponse,
  TransferDetail,
} from '@easysend/shared';
import { EXPIRY_OPTIONS } from '@easysend/shared';
import { nowSeconds } from '../src/clock.js';
import {
  auditLog,
  downloadLogs,
  transferRecipients,
  transfers,
  uploads,
  users,
} from '../src/db/schema/index.js';
import { storagePath } from '../src/storage/paths.js';
import { bodyAs, errorCode, type TestApp, type TestClient } from './helpers.js';
import { loginAs } from './session-helpers.js';
import {
  createDraft,
  createUploadApp,
  filesOf,
  settle,
  uploadBytes,
  userWithClient,
} from './upload-helpers.js';

const detail = (res: { body: unknown }) => res.body as TransferDetail;

/** Draft with one uploaded file, optionally already finalized. */
async function transferWithFile(
  t: TestApp,
  client: TestClient,
  options: { body?: Record<string, unknown>; finalize?: boolean; size?: number } = {},
): Promise<TransferDetail> {
  const draft = await createDraft(client, options.body);
  await uploadBytes(t, client, { transferId: draft.id, data: randomBytes(options.size ?? 2000) });
  await settle(t);
  if (!options.finalize) return draft;
  const res = await client.post(`/api/transfers/${draft.id}/finalize`);
  expect(res.status).toBe(200);
  return detail(res);
}

const auditRows = (t: TestApp, action: string) =>
  t.db.db.select().from(auditLog).where(eq(auditLog.action, action)).all();

describe('POST /api/transfers', () => {
  it('creates a draft in link mode', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    const res = await client.post('/api/transfers', {
      body: { mode: 'link', expiresIn: '1w', title: 'Holiday', message: 'Hi', maxDownloads: 5 },
    });
    expect(res.status).toBe(201);
    const body = detail(res);
    expect(body).toMatchObject({
      status: 'uploading',
      mode: 'link',
      title: 'Holiday',
      message: 'Hi',
      ownerId: user.id,
      shareUrl: null,
      hasPassword: false,
      maxDownloads: 5,
      files: [],
      uploads: [],
    });
    expect(body.expiresAt).toBe(nowSeconds(t.clock) + EXPIRY_OPTIONS['1w']);
    const [entry] = auditRows(t, 'transfer.created');
    expect(entry).toMatchObject({ actorId: user.id, targetId: body.id });
  });

  it('stores recipients lower-cased and the password only as a hash', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const res = await client.post('/api/transfers', {
      body: {
        mode: 'email',
        expiresIn: '3d',
        recipients: ['Anna@Example.com', 'bob@example.com'],
        password: 'link-password-1',
      },
    });
    expect(res.status).toBe(201);
    expect(detail(res).hasPassword).toBe(true);
    expect(detail(res).recipients.map((r) => r.email)).toEqual([
      'anna@example.com',
      'bob@example.com',
    ]);
    const row = t.db.db
      .select()
      .from(transfers)
      .where(eq(transfers.id, detail(res).id))
      .get()!;
    expect(row.passwordHash).not.toBeNull();
    expect(row.passwordHash).not.toContain('link-password-1');
    expect(JSON.stringify(res.body)).not.toContain(row.passwordHash!);
    expect(JSON.stringify(auditRows(t, 'transfer.created'))).not.toContain('link-password-1');
  });

  it('validates the recipients', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const missing = await client.post('/api/transfers', {
      body: { mode: 'email', expiresIn: '3d' },
    });
    expect(missing.status).toBe(400);
    expect(errorCode(missing)).toBe('VALIDATION_ERROR');
    const forbidden = await client.post('/api/transfers', {
      body: { mode: 'link', expiresIn: '3d', recipients: ['a@example.com'] },
    });
    expect(forbidden.status).toBe(400);
    const dup = await client.post('/api/transfers', {
      body: { mode: 'email', expiresIn: '3d', recipients: ['a@example.com', 'A@example.com'] },
    });
    expect(dup.status).toBe(400);
  });

  it('requires a session and the CSRF header', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const body = { mode: 'link', expiresIn: '3d' };
    expect((await t.client().post('/api/transfers', { body })).status).toBe(401);
    const res = await client.post('/api/transfers', { body, csrf: false });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('CSRF_INVALID');
  });

  it('is rate limited per user', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const { client: other } = await userWithClient(t);
    for (let i = 0; i < 30; i += 1) {
      expect(
        (await client.post('/api/transfers', { body: { mode: 'link', expiresIn: '3d' } })).status,
      ).toBe(201);
    }
    const limited = await client.post('/api/transfers', {
      body: { mode: 'link', expiresIn: '3d' },
    });
    expect(limited.status).toBe(429);
    expect(errorCode(limited)).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(
      (await other.post('/api/transfers', { body: { mode: 'link', expiresIn: '3d' } })).status,
    ).toBe(201);
  });
});

describe('POST /api/transfers/:id/finalize', () => {
  it('refuses while an upload is still running', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    const draft = await transferWithFile(t, client);
    for (const status of ['in_progress', 'processing'] as const) {
      const id = randomUUID();
      t.db.db
        .insert(uploads)
        .values({
          id,
          ownerId: user.id,
          transferId: draft.id,
          fileName: 'x',
          totalSize: 10,
          status,
          lastActivityAt: nowSeconds(t.clock),
          expiresAt: nowSeconds(t.clock) + 3600,
        })
        .run();
      const res = await client.post(`/api/transfers/${draft.id}/finalize`);
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('UPLOAD_INCOMPLETE');
      t.db.db.delete(uploads).where(eq(uploads.id, id)).run();
    }
  });

  it('refuses a draft without files', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    const res = await client.post(`/api/transfers/${draft.id}/finalize`);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('TRANSFER_EMPTY');
  });

  it('activates the transfer, restarts the expiry clock and emails the recipients', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await transferWithFile(t, client, {
      body: { mode: 'email', recipients: ['anna@example.com', 'bob@example.com'], title: 'Docs' },
    });
    // An aborted upload is cleaned up when the draft is finalized.
    t.db.db
      .insert(uploads)
      .values({
        id: randomUUID(),
        ownerId: draft.ownerId,
        transferId: draft.id,
        fileName: 'broken',
        totalSize: 1,
        status: 'aborted',
        lastActivityAt: 0,
        expiresAt: 0,
      })
      .run();
    t.clock.advance(600);

    const res = await client.post(`/api/transfers/${draft.id}/finalize`);
    expect(res.status).toBe(200);
    const body = detail(res);
    const row = t.db.db.select().from(transfers).where(eq(transfers.id, draft.id)).get()!;
    expect(body.status).toBe('active');
    expect(body.expiresAt).toBe(nowSeconds(t.clock) + EXPIRY_OPTIONS['1w']);
    expect(body.shareUrl).toBe(`http://localhost:8080/d/${row.token}`);
    expect(body.uploads).toHaveLength(0);
    expect(body.recipients.every((r) => r.notifiedAt === nowSeconds(t.clock))).toBe(true);
    for (const to of ['anna@example.com', 'bob@example.com']) {
      expect(t.mailbox.last(to)?.text).toContain(`/d/${row.token}`);
    }
    expect(auditRows(t, 'transfer.finalized')).toHaveLength(1);

    const again = await client.post(`/api/transfers/${draft.id}/finalize`);
    expect(errorCode(again)).toBe('TRANSFER_NOT_UPLOADABLE');
  });

  it('sends no email in link mode and keeps notified_at empty when sending fails', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const link = await transferWithFile(t, client, { finalize: true });
    expect(link.status).toBe('active');
    expect(t.mailbox.sent).toHaveLength(0);

    t.mailbox.failWith = new Error('smtp down');
    const email = await transferWithFile(t, client, {
      body: { mode: 'email', recipients: ['a@example.com'] },
      finalize: true,
    });
    expect(email.status).toBe('active');
    expect(email.recipients[0]?.notifiedAt).toBeNull();
  });

  it('hides the draft from other users', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const { client: other } = await userWithClient(t);
    const draft = await transferWithFile(t, client);
    const res = await other.post(`/api/transfers/${draft.id}/finalize`);
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('TRANSFER_NOT_FOUND');
  });
});

describe('listing', () => {
  it('lists own transfers newest first with filters and pagination', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const { client: other } = await userWithClient(t);
    const a = await createDraft(client, { title: 'Alpha 100%_off' });
    t.clock.advance(1);
    const b = await createDraft(client, {
      title: 'Beta',
      mode: 'email',
      recipients: ['carla@example.com'],
    });
    t.clock.advance(1);
    const c = await createDraft(client, { title: 'Gamma' });
    await createDraft(other, { title: 'Not mine' });

    const all = bodyAs<ListTransfersResponse>(await client.get('/api/transfers'));
    expect(all.items.map((i) => i.id)).toEqual([c.id, b.id, a.id]);
    expect(all).toMatchObject({ total: 3, page: 1, pageSize: 20 });

    const page2 = bodyAs<ListTransfersResponse>(
      await client.get('/api/transfers?pageSize=2&page=2'),
    );
    expect(page2.items.map((i) => i.id)).toEqual([a.id]);
    expect(page2.total).toBe(3);

    const byMode = bodyAs<ListTransfersResponse>(await client.get('/api/transfers?mode=email'));
    expect(byMode.items.map((i) => i.id)).toEqual([b.id]);
    const byRecipient = bodyAs<ListTransfersResponse>(await client.get('/api/transfers?q=CARLA'));
    expect(byRecipient.items.map((i) => i.id)).toEqual([b.id]);
    const byTitle = bodyAs<ListTransfersResponse>(await client.get('/api/transfers?q=gam'));
    expect(byTitle.items.map((i) => i.id)).toEqual([c.id]);
    // `%` and `_` are literals, not wildcards.
    const percent = bodyAs<ListTransfersResponse>(await client.get('/api/transfers?q=%25_'));
    expect(percent.items.map((i) => i.id)).toEqual([a.id]);
    const wildcard = bodyAs<ListTransfersResponse>(await client.get('/api/transfers?q=%25'));
    expect(wildcard.items.map((i) => i.id)).toEqual([a.id]);
    const uploading = bodyAs<ListTransfersResponse>(
      await client.get('/api/transfers?status=uploading'),
    );
    expect(uploading.total).toBe(3);
    expect(
      bodyAs<ListTransfersResponse>(await client.get('/api/transfers?status=active')).total,
    ).toBe(0);
    expect((await client.get('/api/transfers?status=bogus')).status).toBe(400);
  });

  it('reports an active transfer past its expiry as expired', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    const active = await transferWithFile(t, client, { body: { expiresIn: '3d' }, finalize: true });
    const longer = await transferWithFile(t, client, { body: { expiresIn: '1m' }, finalize: true });

    t.clock.advance(4 * 86_400);
    const later = loginAs(t, user);
    const expired = bodyAs<ListTransfersResponse>(await later.get('/api/transfers?status=expired'));
    expect(expired.items.map((i) => [i.id, i.status])).toEqual([[active.id, 'expired']]);
    const stillActive = bodyAs<ListTransfersResponse>(
      await later.get('/api/transfers?status=active'),
    );
    expect(stillActive.items.map((i) => i.id)).toEqual([longer.id]);
    expect(detail(await later.get(`/api/transfers/${active.id}`)).status).toBe('expired');
  });

  it('adminList shows every user and filters by owner; users cannot call it', async () => {
    const t = await createUploadApp();
    const { user: u1, client: c1 } = await userWithClient(t);
    const { client: c2 } = await userWithClient(t);
    const { client: admin } = await userWithClient(t, { role: 'admin' });
    const a = await createDraft(c1);
    const b = await createDraft(c2);

    const all = bodyAs<ListTransfersResponse>(await admin.get('/api/admin/transfers'));
    expect(all.items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
    expect(all.items[0]?.ownerEmail).toContain('@');
    const mine = bodyAs<ListTransfersResponse>(
      await admin.get(`/api/admin/transfers?ownerId=${u1.id}`),
    );
    expect(mine.items.map((i) => i.id)).toEqual([a.id]);
    const res = await c1.get('/api/admin/transfers');
    expect(res.status).toBe(403);
  });

  it('get: the owner and admins see it, anyone else gets 404', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const { client: other } = await userWithClient(t);
    const { client: admin } = await userWithClient(t, { role: 'admin' });
    const draft = await transferWithFile(t, client);

    const own = detail(await client.get(`/api/transfers/${draft.id}`));
    expect(own.files).toHaveLength(1);
    expect(own.files[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await admin.get(`/api/transfers/${draft.id}`)).status).toBe(200);
    const res = await other.get(`/api/transfers/${draft.id}`);
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('TRANSFER_NOT_FOUND');
    expect((await client.get('/api/transfers/unknown')).status).toBe(404);
  });
});

describe('PATCH /api/transfers/:id', () => {
  it('edits fields, clears them with null and never audits values', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const active = await transferWithFile(t, client, {
      body: { title: 'Old', message: 'Note', maxDownloads: 3 },
      finalize: true,
    });
    t.clock.advance(100);

    const res = await client.patch(`/api/transfers/${active.id}`, {
      body: {
        title: 'New',
        expiresIn: '3d',
        password: 'secret-pass-99',
        maxDownloads: null,
        message: null,
      },
    });
    expect(res.status).toBe(200);
    expect(detail(res)).toMatchObject({
      title: 'New',
      message: null,
      maxDownloads: null,
      hasPassword: true,
      expiresAt: nowSeconds(t.clock) + EXPIRY_OPTIONS['3d'],
    });

    const removed = await client.patch(`/api/transfers/${active.id}`, {
      body: { removePassword: true },
    });
    expect(detail(removed).hasPassword).toBe(false);

    const log = JSON.stringify(auditRows(t, 'transfer.updated'));
    expect(log).toContain('"fields"');
    expect(log).not.toContain('secret-pass-99');
    expect(log).not.toContain('"New"');
    expect(auditRows(t, 'transfer.updated')).toHaveLength(2);
  });

  it('validates the body', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    expect((await client.patch(`/api/transfers/${draft.id}`, { body: {} })).status).toBe(400);
    const both = await client.patch(`/api/transfers/${draft.id}`, {
      body: { password: 'longenough1', removePassword: true },
    });
    expect(both.status).toBe(400);
  });

  it('counts the expiry of a draft from its creation', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client);
    t.clock.advance(500);
    const res = await client.patch(`/api/transfers/${draft.id}`, { body: { expiresIn: '1m' } });
    expect(detail(res).expiresAt).toBe(draft.createdAt + EXPIRY_OPTIONS['1m']);
  });

  it('refuses expired and revoked transfers', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    const a = await transferWithFile(t, client, { body: { expiresIn: '3d' }, finalize: true });
    const b = await transferWithFile(t, client, { finalize: true });
    await client.post(`/api/transfers/${b.id}/revoke`);
    const revoked = await client.patch(`/api/transfers/${b.id}`, { body: { title: 'x' } });
    expect(revoked.status).toBe(410);
    expect(errorCode(revoked)).toBe('TRANSFER_REVOKED');

    t.clock.advance(4 * 86_400);
    const later = loginAs(t, user);
    const expired = await later.patch(`/api/transfers/${a.id}`, { body: { title: 'x' } });
    expect(errorCode(expired)).toBe('TRANSFER_EXPIRED');
  });

  it('lets an admin edit another user transfer and flags it in the audit log', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const { user: adminUser, client: admin } = await userWithClient(t, { role: 'admin' });
    const { client: other } = await userWithClient(t);
    const active = await transferWithFile(t, client, { finalize: true });

    expect(
      (await other.patch(`/api/transfers/${active.id}`, { body: { title: 'x' } })).status,
    ).toBe(404);
    expect(
      (await admin.patch(`/api/transfers/${active.id}`, { body: { title: 'x' } })).status,
    ).toBe(200);
    const [entry] = auditRows(t, 'transfer.updated');
    expect(entry?.actorId).toBe(adminUser.id);
    expect(JSON.stringify(entry?.metadata)).toContain('byAdmin');
  });
});

describe('revoke, resend', () => {
  it('revokes an active transfer, idempotently, and refuses drafts', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const { client: other } = await userWithClient(t);
    const draft = await createDraft(client);
    const refused = await client.post(`/api/transfers/${draft.id}/revoke`);
    expect(refused.status).toBe(409);
    expect(errorCode(refused)).toBe('TRANSFER_NOT_UPLOADABLE');

    const active = await transferWithFile(t, client, { finalize: true });
    expect((await other.post(`/api/transfers/${active.id}/revoke`)).status).toBe(404);
    const first = await client.post(`/api/transfers/${active.id}/revoke`);
    expect(detail(first).status).toBe('revoked');
    const second = await client.post(`/api/transfers/${active.id}/revoke`);
    expect(detail(second).status).toBe('revoked');
    expect(auditRows(t, 'transfer.revoked')).toHaveLength(1);
  });

  it('resends the notification to every recipient', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const active = await transferWithFile(t, client, {
      body: { mode: 'email', recipients: ['a@example.com', 'b@example.com'] },
      finalize: true,
    });
    expect(t.mailbox.sent).toHaveLength(2);
    t.clock.advance(60);

    const res = await client.post(`/api/transfers/${active.id}/resend`);
    expect(res.status).toBe(200);
    expect(t.mailbox.sent).toHaveLength(4);
    expect(detail(res).recipients.every((r) => r.notifiedAt === nowSeconds(t.clock))).toBe(true);
    expect(auditRows(t, 'transfer.resent')).toHaveLength(1);
  });

  it('refuses resend for link mode, drafts, revoked and expired transfers', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    const link = await transferWithFile(t, client, { finalize: true });
    const linkRes = await client.post(`/api/transfers/${link.id}/resend`);
    expect(linkRes.status).toBe(409);
    expect(errorCode(linkRes)).toBe('CONFLICT');

    const draft = await createDraft(client, { mode: 'email', recipients: ['a@example.com'] });
    expect(errorCode(await client.post(`/api/transfers/${draft.id}/resend`))).toBe('CONFLICT');

    const revoked = await transferWithFile(t, client, {
      body: { mode: 'email', recipients: ['a@example.com'], expiresIn: '3d' },
      finalize: true,
    });
    const expiring = await transferWithFile(t, client, {
      body: { mode: 'email', recipients: ['a@example.com'], expiresIn: '3d' },
      finalize: true,
    });
    await client.post(`/api/transfers/${revoked.id}/revoke`);
    expect(errorCode(await client.post(`/api/transfers/${revoked.id}/resend`))).toBe(
      'TRANSFER_REVOKED',
    );

    t.clock.advance(4 * 86_400);
    const later = loginAs(t, user);
    expect(errorCode(await later.post(`/api/transfers/${expiring.id}/resend`))).toBe(
      'TRANSFER_EXPIRED',
    );
  });
});

describe('delete', () => {
  it('deletes a transfer, its files and releases the quota', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    const { client: other } = await userWithClient(t);
    const active = await transferWithFile(t, client, { finalize: true, size: 3000 });
    const [file] = filesOf(t, active.id);
    const path = storagePath(t.config, file!.storageName);
    expect(existsSync(path)).toBe(true);
    expect(t.db.db.select().from(users).where(eq(users.id, user.id)).get()?.usedBytes).toBe(3000);

    expect((await other.delete(`/api/transfers/${active.id}`)).status).toBe(404);
    const res = await client.delete(`/api/transfers/${active.id}`);
    expect(res.status).toBe(204);
    expect(existsSync(path)).toBe(false);
    expect((await client.get(`/api/transfers/${active.id}`)).status).toBe(404);
    expect(t.db.db.select().from(users).where(eq(users.id, user.id)).get()?.usedBytes).toBe(0);
    expect(auditRows(t, 'transfer.deleted')).toHaveLength(1);
  });

  it('lets an admin delete another user transfer', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const { client: admin } = await userWithClient(t, { role: 'admin' });
    const draft = await createDraft(client);
    expect((await admin.delete(`/api/transfers/${draft.id}`)).status).toBe(204);
    expect(JSON.stringify(auditRows(t, 'transfer.deleted')[0]?.metadata)).toContain('byAdmin');
  });
});

describe('DELETE /api/transfers/:id/files/:fileId', () => {
  it('removes a file from a draft only', async () => {
    const t = await createUploadApp();
    const { user, client } = await userWithClient(t);
    const { client: other } = await userWithClient(t);
    const draft = await transferWithFile(t, client, { size: 1500 });
    const [file] = filesOf(t, draft.id);
    const path = storagePath(t.config, file!.storageName);

    expect((await other.delete(`/api/transfers/${draft.id}/files/${file!.id}`)).status).toBe(404);
    const missing = await client.delete(`/api/transfers/${draft.id}/files/nope`);
    expect(missing.status).toBe(404);
    expect(errorCode(missing)).toBe('FILE_NOT_FOUND');

    const res = await client.delete(`/api/transfers/${draft.id}/files/${file!.id}`);
    expect(res.status).toBe(204);
    expect(existsSync(path)).toBe(false);
    expect(filesOf(t, draft.id)).toHaveLength(0);
    expect(t.db.db.select().from(users).where(eq(users.id, user.id)).get()?.usedBytes).toBe(0);
    expect(detail(await client.get(`/api/transfers/${draft.id}`)).files).toHaveLength(0);

    const active = await transferWithFile(t, client, { finalize: true });
    const [activeFile] = filesOf(t, active.id);
    const refused = await client.delete(`/api/transfers/${active.id}/files/${activeFile!.id}`);
    expect(refused.status).toBe(409);
    expect(errorCode(refused)).toBe('TRANSFER_NOT_UPLOADABLE');
  });
});

describe('GET /api/transfers/:id/downloads', () => {
  it('lists the download log newest first, without IP data', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const { client: other } = await userWithClient(t);
    const active = await transferWithFile(t, client, { finalize: true });
    const [file] = filesOf(t, active.id);
    const insert = (createdAt: number, fileId: string | null, ua: string | null) =>
      t.db.db
        .insert(downloadLogs)
        .values({
          transferId: active.id,
          fileId,
          ipHash: 'hash',
          userAgent: ua,
          bytesSent: 10,
          createdAt,
        })
        .run();
    insert(100, file!.id, 'UA-1');
    insert(300, null, null);
    insert(200, 'deleted-file', 'UA-3');

    const res = await client.get(`/api/transfers/${active.id}/downloads`);
    expect(res.status).toBe(200);
    const body = bodyAs<ListDownloadLogsResponse>(res);
    expect(body.total).toBe(3);
    expect(body.items.map((i) => i.createdAt)).toEqual([300, 200, 100]);
    expect(body.items[2]).toMatchObject({
      fileId: file!.id,
      fileName: file!.originalName,
      userAgent: 'UA-1',
    });
    expect(body.items[0]).toMatchObject({ fileId: null, fileName: null });
    expect(body.items[1]?.fileName).toBeNull();
    expect(JSON.stringify(body)).not.toContain('hash');

    const page = bodyAs<ListDownloadLogsResponse>(
      await client.get(`/api/transfers/${active.id}/downloads?pageSize=2&page=2`),
    );
    expect(page.items.map((i) => i.createdAt)).toEqual([100]);
    expect((await other.get(`/api/transfers/${active.id}/downloads`)).status).toBe(404);
  });
});

describe('recipients table', () => {
  it('keeps one row per recipient', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const draft = await createDraft(client, {
      mode: 'email',
      recipients: ['a@example.com', 'b@example.com'],
    });
    expect(
      t.db.db
        .select()
        .from(transferRecipients)
        .where(eq(transferRecipients.transferId, draft.id))
        .all(),
    ).toHaveLength(2);
  });
});
