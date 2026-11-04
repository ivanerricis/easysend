import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type {
  CreateSubmissionResponse,
  RequestInfoResponse,
  SubmissionStatusResponse,
  UploadRequestDetail,
  UploadRequestSummary,
} from '@easysend/shared';
import { transfers, uploadRequests, users } from '../src/db/schema/index.js';
import { runCleanup } from '../src/jobs/cleanup.js';
import { csrfClient } from './auth-flow.js';
import { bodyAs, errorCode, type TestApp, type TestClient } from './helpers.js';
import { loginAs } from './session-helpers.js';
import { createUploadApp, settle, uploadMetadata, userWithClient } from './upload-helpers.js';

const ok = { title: 'Docs', expiresIn: '1w' } as const;

async function setup(env: Record<string, string> = {}) {
  const t = await createUploadApp({ env });
  const { user, client } = await userWithClient(t, { email: 'owner@example.com' });
  return { t, owner: user, client };
}

async function createRequest(client: TestClient, body: Record<string, unknown> = {}) {
  const res = await client.post('/api/requests', { body: { ...ok, ...body } });
  expect(res.status).toBe(201);
  const detail = bodyAs<UploadRequestDetail>(res);
  return { ...detail, token: detail.shareUrl!.split('/r/')[1]! };
}

const tusHeaders = (token: string, extra: Record<string, string> = {}) => ({
  'Tus-Resumable': '1.0.0',
  'X-Submission-Token': token,
  ...extra,
});

interface Submission {
  anon: TestClient;
  transferId: string;
  token: string;
}

async function startSubmission(
  t: TestApp,
  requestToken: string,
  body: Record<string, unknown> = {},
  anon?: TestClient,
): Promise<Submission> {
  const client = anon ?? (await csrfClient(t));
  const res = await client.post(`/api/r/${requestToken}/submissions`, { body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const created = bodyAs<CreateSubmissionResponse>(res);
  return { anon: client, transferId: created.transferId, token: created.submissionToken };
}

const tusCreate = (s: Submission, size: number, transferId = s.transferId, token = s.token) =>
  s.anon.post('/api/uploads', {
    headers: tusHeaders(token, {
      'Upload-Length': String(size),
      'Upload-Metadata': uploadMetadata({ transferId, filename: 'f.bin' }),
    }),
  });

const tusPatch = (s: Submission, location: string, data: Buffer, offset = 0) =>
  s.anon.patch(location, {
    headers: tusHeaders(s.token, {
      'Content-Type': 'application/offset+octet-stream',
      'Upload-Offset': String(offset),
    }),
    body: data,
  });

async function upload(s: Submission, data: Buffer) {
  const created = await tusCreate(s, data.length);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const location = String(created.headers.location);
  const res = await tusPatch(s, location, data);
  expect(res.status).toBe(204);
  return location;
}

const submissionPath = (requestToken: string, s: Submission, suffix = '') =>
  `/api/r/${requestToken}/submissions/${s.transferId}${suffix}`;

const withToken = (s: Submission) => ({ headers: { 'X-Submission-Token': s.token } });

describe('upload requests: owner API', () => {
  it('creates, lists, reads, edits, revokes and deletes; only the owner sees a request', async () => {
    const { t, client } = await setup();
    const created = await createRequest(client, {
      message: 'Send me the files',
      maxSubmissions: 5,
    });
    expect(created.shareUrl).toMatch(/^http:\/\/localhost:8080\/r\/[A-Za-z0-9_-]{43}$/);
    expect(created).toMatchObject({
      title: 'Docs',
      status: 'active',
      hasPassword: false,
      requireName: false,
      submissionCount: 0,
      maxSubmissions: 5,
      expiresIn: '1w',
      transfers: [],
    });

    const list = await client.get('/api/requests');
    expect(bodyAs<{ items: UploadRequestSummary[]; total: number }>(list).total).toBe(1);

    const patched = await client.patch(`/api/requests/${created.id}`, {
      body: {
        title: 'Renamed',
        password: 'long-enough-pw',
        requireEmail: true,
        maxTotalBytes: 5000,
      },
    });
    expect(bodyAs<UploadRequestDetail>(patched)).toMatchObject({
      title: 'Renamed',
      hasPassword: true,
      requireEmail: true,
      maxTotalBytes: 5000,
    });
    const cleared = await client.patch(`/api/requests/${created.id}`, {
      body: { removePassword: true, maxTotalBytes: null },
    });
    expect(bodyAs<UploadRequestDetail>(cleared)).toMatchObject({
      hasPassword: false,
      maxTotalBytes: null,
    });

    // Another user and an admin both get 404.
    const other = loginAs(t, await t.createUser());
    const admin = loginAs(t, await t.createUser({ role: 'admin' }));
    for (const who of [other, admin]) {
      for (const res of [
        await who.get(`/api/requests/${created.id}`),
        await who.patch(`/api/requests/${created.id}`, { body: { title: 'x' } }),
        await who.post(`/api/requests/${created.id}/revoke`),
        await who.delete(`/api/requests/${created.id}`),
      ]) {
        expect(res.status).toBe(404);
        expect(errorCode(res)).toBe('REQUEST_NOT_FOUND');
      }
    }
    expect(bodyAs<{ total: number }>(await other.get('/api/requests')).total).toBe(0);

    const revoked = await client.post(`/api/requests/${created.id}/revoke`);
    expect(bodyAs<UploadRequestDetail>(revoked).status).toBe('revoked');
    expect((await client.post(`/api/requests/${created.id}/revoke`)).status).toBe(200);
    const edit = await client.patch(`/api/requests/${created.id}`, { body: { title: 'x' } });
    expect(errorCode(edit)).toBe('REQUEST_REVOKED');

    expect((await client.delete(`/api/requests/${created.id}`)).status).toBe(204);
    expect((await client.get(`/api/requests/${created.id}`)).status).toBe(404);
  });

  it('reports an active request past its expiry as expired', async () => {
    const { t, client } = await setup();
    const created = await createRequest(client);
    t.db.db
      .update(uploadRequests)
      .set({ expiresAt: 1 })
      .where(eq(uploadRequests.id, created.id))
      .run();
    const got = await client.get(`/api/requests/${created.id}`);
    expect(bodyAs<UploadRequestDetail>(got).status).toBe('expired');
    const filtered = await client.get('/api/requests?status=expired');
    expect(bodyAs<{ total: number }>(filtered).total).toBe(1);
    const edit = await client.patch(`/api/requests/${created.id}`, { body: { title: 'x' } });
    expect(errorCode(edit)).toBe('REQUEST_EXPIRED');
  });
});

describe('upload requests: public API', () => {
  it('shows the info without the owner email, and the locked variant until unlocked', async () => {
    const { t, client } = await setup();
    const open = await createRequest(client, { message: 'Hi', maxTotalBytes: 1000 });
    const anon = await csrfClient(t);
    const info = await anon.get(`/api/r/${open.token}`);
    expect(info.status).toBe(200);
    expect(bodyAs<RequestInfoResponse>(info)).toMatchObject({
      locked: false,
      title: 'Docs',
      message: 'Hi',
      ownerName: null,
      remainingBytes: 1000,
      chunkSizeBytes: 25 * 1024 * 1024,
      maxFilesPerTransfer: 1000,
    });
    expect(JSON.stringify(info.body)).not.toContain('owner@example.com');

    const locked = await createRequest(client, { password: 'long-enough-pw' });
    const lockedInfo = await anon.get(`/api/r/${locked.token}`);
    expect(bodyAs<RequestInfoResponse>(lockedInfo)).toMatchObject({ locked: true });
    expect(Object.keys(lockedInfo.body).sort()).toEqual(['expiresAt', 'locked']);

    const before = await anon.post(`/api/r/${locked.token}/submissions`, { body: {} });
    expect(errorCode(before)).toBe('PASSWORD_REQUIRED');
    const wrong = await anon.post(`/api/r/${locked.token}/unlock`, {
      body: { password: 'nope-nope-nope' },
    });
    expect(errorCode(wrong)).toBe('PASSWORD_INCORRECT');

    const unlocked = await anon.post(`/api/r/${locked.token}/unlock`, {
      body: { password: 'long-enough-pw' },
    });
    expect(unlocked.status).toBe(204);
    const cookie = String(unlocked.headers['set-cookie']);
    expect(cookie).toContain('es_ru=');
    expect(cookie).toContain(`Path=/api/r/${locked.token}`);
    expect(cookie).toContain('SameSite=Strict');
    expect(bodyAs<RequestInfoResponse>(await anon.get(`/api/r/${locked.token}`)).locked).toBe(
      false,
    );
    await startSubmission(t, locked.token, {}, anon);

    // Changing the password invalidates the cookie.
    await client.patch(`/api/requests/${locked.id}`, { body: { password: 'another-long-pw' } });
    expect(bodyAs<RequestInfoResponse>(await anon.get(`/api/r/${locked.token}`)).locked).toBe(true);
  });

  it('refuses a missing required name or email on the field', async () => {
    const { t, client } = await setup();
    const req = await createRequest(client, { requireName: true, requireEmail: true });
    const anon = await csrfClient(t);
    const res = await anon.post(`/api/r/${req.token}/submissions`, { body: { name: 'Ann' } });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).toContain('"path":"email"');
    await startSubmission(t, req.token, { name: 'Ann', email: 'Ann@Example.com' }, anon);
    const row = t.db.db
      .select()
      .from(transfers)
      .all()
      .find((r) => r.source === 'received')!;
    expect(row).toMatchObject({
      senderName: 'Ann',
      senderEmail: 'ann@example.com',
      status: 'uploading',
    });
  });

  it('runs a whole anonymous submission and informs the owner', async () => {
    const { t, client, owner } = await setup();
    const req = await createRequest(client, { title: 'Tax\r\nBcc: x@evil' });
    const s = await startSubmission(t, req.token, {
      name: 'Marco\nBianchi',
      email: 'marco@example.com',
      message: 'Here you go',
    });
    const a = randomBytes(1000);
    const b = randomBytes(2000);
    await upload(s, a);
    await upload(s, b);

    // Not final until encrypted.
    await settle(t);
    const state = await s.anon.get(submissionPath(req.token, s), withToken(s));
    expect(bodyAs<SubmissionStatusResponse>(state)).toMatchObject({ status: 'uploading' });
    expect(bodyAs<SubmissionStatusResponse>(state).files).toHaveLength(2);

    const fin = await s.anon.post(submissionPath(req.token, s, '/finalize'), withToken(s));
    expect(fin.status, JSON.stringify(fin.body)).toBe(200);
    expect(fin.body).toMatchObject({ transferId: s.transferId, fileCount: 2, totalBytes: 3000 });

    // Counters, the received transfer and the audit row.
    const detail = bodyAs<UploadRequestDetail>(await client.get(`/api/requests/${req.id}`));
    expect(detail).toMatchObject({ submissionCount: 1, receivedBytes: 3000 });
    expect(detail.transfers).toHaveLength(1);
    expect(detail.transfers[0]).toMatchObject({
      id: s.transferId,
      source: 'received',
      status: 'active',
      senderName: 'Marco\nBianchi',
      uploadRequestId: req.id,
      fileCount: 2,
    });
    const received = await client.get('/api/transfers?source=received');
    expect(bodyAs<{ total: number }>(received).total).toBe(1);
    expect(bodyAs<{ total: number }>(await client.get('/api/transfers?source=sent')).total).toBe(0);

    // Owner email: link to the transfer, header-safe subject, nothing from the uploader leaks.
    const mail = t.mailbox.last(owner.email)!;
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text).toContain(`http://localhost:8080/transfers/${s.transferId}`);
    expect(mail.text).toContain('Marco Bianchi <marco@example.com>');
    expect(mail.text).toContain('2 file');

    // The submission is finished: no more chunks, no second finalize, no cancel.
    expect(
      errorCode(await s.anon.post(submissionPath(req.token, s, '/finalize'), withToken(s))),
    ).toBe('TRANSFER_NOT_UPLOADABLE');
    expect(errorCode(await s.anon.delete(submissionPath(req.token, s), withToken(s)))).toBe(
      'TRANSFER_NOT_UPLOADABLE',
    );
    expect(errorCode(await tusCreate(s, 10))).toBe('TRANSFER_NOT_UPLOADABLE');
  });

  it('does not send the first-download notice for a received transfer', async () => {
    const { t, client, owner } = await setup();
    const req = await createRequest(client);
    const s = await startSubmission(t, req.token);
    await upload(s, randomBytes(500));
    await settle(t);
    await s.anon.post(submissionPath(req.token, s, '/finalize'), withToken(s));
    const sentBefore = t.mailbox.sent.length;
    const row = t.db.db.select().from(transfers).where(eq(transfers.id, s.transferId)).get()!;
    const info = await t.client().get(`/api/downloads/${row.token}`);
    const fileId = (info.body.files as { id: string }[])[0]!.id;
    const dl = await t.client().get(`/api/downloads/${row.token}/files/${fileId}`);
    expect(dl.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(t.mailbox.sent.length).toBe(sentBefore);
    expect(
      t.db.db.select().from(transfers).where(eq(transfers.id, s.transferId)).get()!.notifiedAt,
    ).toBeNull();
    expect(owner.email).toBeTruthy();
  });

  it('cancels an unfinished submission', async () => {
    const { t, client } = await setup();
    const req = await createRequest(client);
    const s = await startSubmission(t, req.token);
    expect((await s.anon.delete(submissionPath(req.token, s), withToken(s))).status).toBe(204);
    expect(
      t.db.db.select().from(transfers).where(eq(transfers.id, s.transferId)).all(),
    ).toHaveLength(0);
  });

  it('refuses an expired request everywhere', async () => {
    const { t, client } = await setup();
    const req = await createRequest(client);
    const s = await startSubmission(t, req.token);
    t.db.db.update(uploadRequests).set({ expiresAt: 1 }).where(eq(uploadRequests.id, req.id)).run();
    const anon = await csrfClient(t);
    expect(errorCode(await anon.get(`/api/r/${req.token}`))).toBe('REQUEST_EXPIRED');
    expect(errorCode(await anon.post(`/api/r/${req.token}/submissions`, { body: {} }))).toBe(
      'REQUEST_EXPIRED',
    );
    expect(errorCode(await tusCreate(s, 10))).toBe('REQUEST_EXPIRED');
    expect(
      errorCode(await s.anon.post(submissionPath(req.token, s, '/finalize'), withToken(s))),
    ).toBe('REQUEST_EXPIRED');
  });

  it('stops at max_submissions with REQUEST_FULL', async () => {
    const { t, client } = await setup();
    const req = await createRequest(client, { maxSubmissions: 1 });
    const first = await startSubmission(t, req.token);
    const second = await startSubmission(t, req.token); // drafts are not counted yet
    for (const s of [first, second]) {
      await upload(s, randomBytes(100));
    }
    await settle(t);
    expect(
      (await first.anon.post(submissionPath(req.token, first, '/finalize'), withToken(first)))
        .status,
    ).toBe(200);
    // The racing draft loses at finalize, and nobody can start another one.
    expect(
      errorCode(
        await second.anon.post(submissionPath(req.token, second, '/finalize'), withToken(second)),
      ),
    ).toBe('REQUEST_FULL');
    const anon = await csrfClient(t);
    expect(errorCode(await anon.post(`/api/r/${req.token}/submissions`, { body: {} }))).toBe(
      'REQUEST_FULL',
    );
    expect(errorCode(await anon.get(`/api/r/${req.token}`))).toBe('REQUEST_FULL');
  });

  it('enforces max_total_bytes with REQUEST_SIZE_LIMIT, counting uploads in flight', async () => {
    const { t, client } = await setup();
    const req = await createRequest(client, { maxTotalBytes: 1000 });
    const a = await startSubmission(t, req.token);
    const b = await startSubmission(t, req.token);
    await upload(a, randomBytes(600));
    const res = await tusCreate(b, 600);
    expect(res.status).toBe(413);
    expect(errorCode(res)).toBe('REQUEST_SIZE_LIMIT');
    expect((await tusCreate(b, 400)).status).toBe(201);
  });

  it('enforces the owner quota', async () => {
    const { t, client, owner } = await setup();
    t.db.db.update(users).set({ quotaBytes: 100 }).where(eq(users.id, owner.id)).run();
    const req = await createRequest(client);
    const s = await startSubmission(t, req.token);
    const res = await tusCreate(s, 200);
    expect(res.status).toBe(413);
    expect(errorCode(res)).toBe('QUOTA_EXCEEDED');
  });

  it('refuses the token of another submission, a missing token and a session on a received draft', async () => {
    const { t, client } = await setup();
    const req = await createRequest(client);
    const a = await startSubmission(t, req.token);
    const b = await startSubmission(t, req.token);

    // tus: metadata of B with the token of A.
    expect(errorCode(await tusCreate(a, 10, b.transferId))).toBe('TRANSFER_NOT_FOUND');
    // A's upload cannot be driven with B's token.
    const location = String((await tusCreate(a, 10)).headers.location);
    const cross = await b.anon.patch(location, {
      headers: tusHeaders(b.token, {
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': '0',
      }),
      body: Buffer.alloc(10),
    });
    expect(cross.status).toBe(404);

    for (const res of [
      await a.anon.get(submissionPath(req.token, b), withToken(a)),
      await a.anon.post(submissionPath(req.token, b, '/finalize'), withToken(a)),
      await a.anon.delete(submissionPath(req.token, b), withToken(a)),
      await a.anon.get(submissionPath(req.token, b)),
    ]) {
      expect(res.status).toBe(404);
      expect(errorCode(res)).toBe('TRANSFER_NOT_FOUND');
    }

    // The owner session cannot fill or finalize a received draft either.
    const viaSession = await client.post('/api/uploads', {
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': '10',
        'Upload-Metadata': uploadMetadata({ transferId: a.transferId, filename: 'f.bin' }),
      },
    });
    expect(errorCode(viaSession)).toBe('TRANSFER_NOT_UPLOADABLE');
    expect(errorCode(await client.post(`/api/transfers/${a.transferId}/finalize`))).toBe(
      'TRANSFER_NOT_UPLOADABLE',
    );
    // Resend of a received transfer is not possible.
    expect(errorCode(await client.post(`/api/transfers/${a.transferId}/resend`))).toBe('CONFLICT');
  });

  it('refuses the next chunk and finalize once the request is revoked', async () => {
    const { t, client } = await setup();
    const req = await createRequest(client);
    const s = await startSubmission(t, req.token);
    const data = randomBytes(2000);
    const created = await tusCreate(s, data.length);
    const location = String(created.headers.location);
    expect((await tusPatch(s, location, data.subarray(0, 1000))).status).toBe(204);

    await client.post(`/api/requests/${req.id}/revoke`);
    const next = await tusPatch(s, location, data.subarray(1000), 1000);
    expect(next.status).toBe(410);
    expect(errorCode(next)).toBe('REQUEST_REVOKED');
    expect(errorCode(await tusCreate(s, 10))).toBe('REQUEST_REVOKED');
    expect(
      errorCode(await s.anon.post(submissionPath(req.token, s, '/finalize'), withToken(s))),
    ).toBe('REQUEST_REVOKED');
    // The uploader can still cancel.
    expect((await s.anon.delete(submissionPath(req.token, s), withToken(s))).status).toBe(204);
  });

  it('rate limits new submissions per IP', async () => {
    const { t, client } = await setup();
    const req = await createRequest(client);
    const anon = await csrfClient(t);
    let last = 0;
    for (let i = 0; i < 21; i++) {
      const res = await anon.post(`/api/r/${req.token}/submissions`, { body: {} });
      last = res.status;
      if (i < 20) expect(res.status).toBe(201);
    }
    expect(last).toBe(429);
  });
});

describe('upload requests: cleanup and deleted users', () => {
  it('cleanup removes expired and revoked requests but keeps the received transfers', async () => {
    const { t, client } = await setup();
    const expired = await createRequest(client);
    const revoked = await createRequest(client);
    const live = await createRequest(client);
    const s = await startSubmission(t, expired.token);
    await upload(s, randomBytes(100));
    await settle(t);
    await s.anon.post(submissionPath(expired.token, s, '/finalize'), withToken(s));
    t.db.db
      .update(uploadRequests)
      .set({ expiresAt: 1 })
      .where(eq(uploadRequests.id, expired.id))
      .run();
    await client.post(`/api/requests/${revoked.id}/revoke`);

    const report = await runCleanup(t.ctx);
    expect(report.deletedRequests).toBe(2);
    const left = t.db.db.select().from(uploadRequests).all();
    expect(left.map((r) => r.id)).toEqual([live.id]);
    const kept = t.db.db.select().from(transfers).where(eq(transfers.id, s.transferId)).get()!;
    expect(kept).toMatchObject({ source: 'received', status: 'active', uploadRequestId: null });
  });

  it('deleting a user moves the requests with reassign and removes them with delete', async () => {
    const { t, client, owner } = await setup();
    const admin = await t.createUser({ role: 'admin' });
    const adminClient = loginAs(t, admin);
    const target = await t.createUser();
    const req = await createRequest(client);

    const res = await adminClient.delete(
      `/api/admin/users/${owner.id}?transfers=reassign&reassignTo=${target.id}`,
    );
    expect(res.status).toBe(204);
    const moved = t.db.db.select().from(uploadRequests).where(eq(uploadRequests.id, req.id)).get()!;
    expect(moved.ownerId).toBe(target.id);

    const res2 = await adminClient.delete(`/api/admin/users/${target.id}?transfers=delete`);
    expect(res2.status).toBe(204);
    expect(t.db.db.select().from(uploadRequests).all()).toHaveLength(0);
  });
});
