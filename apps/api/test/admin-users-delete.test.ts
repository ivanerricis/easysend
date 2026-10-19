import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, sessions, transfers, uploads, users } from '../src/db/schema/index.js';
import { errorCode, createTestApp, type TestApp } from './helpers.js';
import {
  createCleanupApp,
  exists,
  insertStoredFile,
  insertTransfer,
  insertUpload,
} from './cleanup-fixtures.js';
import { loginAs } from './session-helpers.js';

async function setup() {
  const t = await createTestApp();
  const admin = await t.createUser({ role: 'admin', email: 'admin@example.com' });
  return { t, admin, client: loginAs(t, admin) };
}

function seedTransfer(
  t: TestApp,
  ownerId: string,
  token: string,
  status: 'active' | 'expired' = 'active',
) {
  t.db.db
    .insert(transfers)
    .values({ ownerId, token, mode: 'link', expiresAt: 9_999_999_999, status, totalBytes: 10 })
    .run();
}

function seedUpload(
  t: TestApp,
  ownerId: string,
  id: string,
  status: 'in_progress' | 'processing' = 'in_progress',
) {
  t.db.db
    .insert(uploads)
    .values({
      id,
      ownerId,
      fileName: 'f.bin',
      totalSize: 10,
      status,
      lastActivityAt: 1,
      expiresAt: 9_999_999_999,
    })
    .run();
}

const ownedBy = (t: TestApp, id: string) =>
  t.db.db.select().from(transfers).where(eq(transfers.ownerId, id)).all();

describe('DELETE /api/admin/users/:id', () => {
  it('transfers=delete removes the user, their transfers and uploads, and the sessions', async () => {
    const { t, client } = await setup();
    const doomed = await t.createUser({ email: 'doomed@example.com' });
    const keeper = await t.createUser();
    seedTransfer(t, doomed.id, 'a');
    seedTransfer(t, doomed.id, 'b', 'expired');
    seedTransfer(t, keeper.id, 'c');
    seedUpload(t, doomed.id, 'up1');
    const victim = loginAs(t, doomed);

    const res = await client.delete(`/api/admin/users/${doomed.id}?transfers=delete`);
    expect(res.status).toBe(204);
    expect(t.db.db.select().from(users).where(eq(users.id, doomed.id)).get()).toBeUndefined();
    expect(ownedBy(t, doomed.id)).toHaveLength(0);
    expect(t.db.db.select().from(uploads).all()).toHaveLength(0);
    expect(ownedBy(t, keeper.id)).toHaveLength(1);
    expect(
      t.db.db.select().from(sessions).where(eq(sessions.userId, doomed.id)).all(),
    ).toHaveLength(0);
    expect((await victim.get('/api/me')).status).toBe(401);

    const audit = t.db.db.select().from(auditLog).where(eq(auditLog.action, 'admin.user_deleted'));
    expect(audit.all()).toHaveLength(1);
    expect(audit.get()!.targetId).toBe(doomed.id);
    expect(JSON.stringify(audit.get()!.metadata)).not.toContain('doomed@');
  });

  it('transfers=reassign moves transfers, uploads and used_bytes to the new owner', async () => {
    const { t, client } = await setup();
    const doomed = await t.createUser();
    const target = await t.createUser();
    t.db.db.update(users).set({ usedBytes: 300 }).where(eq(users.id, doomed.id)).run();
    t.db.db.update(users).set({ usedBytes: 50 }).where(eq(users.id, target.id)).run();
    seedTransfer(t, doomed.id, 'a');
    seedTransfer(t, doomed.id, 'b');
    // A `processing` upload is handed over; an `in_progress` one would be aborted (see below).
    seedUpload(t, doomed.id, 'up1', 'processing');

    const res = await client.delete(
      `/api/admin/users/${doomed.id}?transfers=reassign&reassignTo=${target.id}`,
    );
    expect(res.status).toBe(204);
    expect(t.db.db.select().from(users).where(eq(users.id, doomed.id)).get()).toBeUndefined();
    expect(ownedBy(t, target.id)).toHaveLength(2);
    expect(t.db.db.select().from(uploads).get()!.ownerId).toBe(target.id);
    expect(t.db.db.select().from(users).where(eq(users.id, target.id)).get()!.usedBytes).toBe(350);
  });

  it('reassign validates the target and changes nothing on failure', async () => {
    const { t, client } = await setup();
    const doomed = await t.createUser();
    seedTransfer(t, doomed.id, 'a');

    const missingTarget = await client.delete(
      `/api/admin/users/${doomed.id}?transfers=reassign&reassignTo=nobody`,
    );
    expect(missingTarget.status).toBe(404);
    expect(errorCode(missingTarget)).toBe('USER_NOT_FOUND');

    const sameUser = await client.delete(
      `/api/admin/users/${doomed.id}?transfers=reassign&reassignTo=${doomed.id}`,
    );
    expect(sameUser.status).toBe(400);
    expect(errorCode(sameUser)).toBe('VALIDATION_ERROR');

    const noTarget = await client.delete(`/api/admin/users/${doomed.id}?transfers=reassign`);
    expect(noTarget.status).toBe(400);

    expect(await client.delete(`/api/admin/users/${doomed.id}`)).toMatchObject({ status: 400 });
    expect(t.db.db.select().from(users).where(eq(users.id, doomed.id)).get()).toBeDefined();
    expect(ownedBy(t, doomed.id)).toHaveLength(1);
  });

  it('cannot delete yourself (CONFLICT), even when other admins exist', async () => {
    const { t, client, admin } = await setup();
    await t.createUser({ role: 'admin' });
    const res = await client.delete(`/api/admin/users/${admin.id}?transfers=delete`);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('CONFLICT');
    expect(t.db.db.select().from(users).where(eq(users.id, admin.id)).get()).toBeDefined();
  });

  it('deletes another admin when a second active admin remains (LAST_ADMIN is unreachable here)', async () => {
    const { t, client, admin } = await setup();
    const other = await t.createUser({ role: 'admin' });
    const res = await client.delete(`/api/admin/users/${other.id}?transfers=delete`);
    expect(res.status).toBe(204);
    expect(t.db.db.select().from(users).where(eq(users.id, admin.id)).get()).toBeDefined();
  });

  it('answers USER_NOT_FOUND for an unknown id', async () => {
    const { client } = await setup();
    const res = await client.delete('/api/admin/users/nope?transfers=delete');
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('USER_NOT_FOUND');
  });
});

describe('DELETE /api/admin/users/:id and files on disk', () => {
  async function setupDisk() {
    const t = await createCleanupApp();
    const admin = await t.createUser({ role: 'admin', email: 'admin@example.com' });
    return { t, admin, client: loginAs(t, admin) };
  }

  it('transfers=delete unlinks encrypted files and tus files after the commit', async () => {
    const { t, client } = await setupDisk();
    const doomed = await t.createUser();
    const keeper = await t.createUser();
    const doomedTransfer = insertTransfer(t, { ownerId: doomed.id, status: 'active' });
    const doomedFile = await insertStoredFile(t, doomedTransfer, doomed.id);
    const keeperTransfer = insertTransfer(t, { ownerId: keeper.id, status: 'active' });
    const keeperFile = await insertStoredFile(t, keeperTransfer, keeper.id);
    const inProgress = insertUpload(t, { ownerId: doomed.id, status: 'in_progress' });
    const processing = insertUpload(t, {
      ownerId: doomed.id,
      status: 'processing',
      transferId: doomedTransfer,
    });

    const res = await client.delete(`/api/admin/users/${doomed.id}?transfers=delete`);
    expect(res.status).toBe(204);
    for (const file of [
      doomedFile.path,
      inProgress.data,
      inProgress.info,
      processing.data,
      processing.info,
    ]) {
      expect(exists(file)).toBe(false);
    }
    expect(exists(keeperFile.path)).toBe(true);
    expect(t.db.db.select().from(uploads).all()).toHaveLength(0);
  });

  it('reassign aborts in-progress uploads, hands processing ones over and carries used_bytes', async () => {
    const { t, client } = await setupDisk();
    const doomed = await t.createUser();
    const target = await t.createUser();
    const transferId = insertTransfer(t, { ownerId: doomed.id, status: 'active' });
    const file = await insertStoredFile(t, transferId, doomed.id, 'twelve bytes');
    const inProgress = insertUpload(t, { ownerId: doomed.id, status: 'in_progress' });
    const processing = insertUpload(t, { ownerId: doomed.id, status: 'processing' });

    const res = await client.delete(
      `/api/admin/users/${doomed.id}?transfers=reassign&reassignTo=${target.id}`,
    );
    expect(res.status).toBe(204);
    expect(exists(inProgress.data) || exists(inProgress.info)).toBe(false);
    expect(exists(processing.data)).toBe(true);
    expect(exists(file.path)).toBe(true);
    const remaining = t.db.db.select().from(uploads).all();
    expect(remaining.map((u) => [u.id, u.ownerId])).toEqual([[processing.id, target.id]]);
    expect(t.db.db.select().from(users).where(eq(users.id, target.id)).get()!.usedBytes).toBe(12);
    expect(
      t.db.db.select().from(transfers).where(eq(transfers.ownerId, target.id)).all(),
    ).toHaveLength(1);
  });
});
