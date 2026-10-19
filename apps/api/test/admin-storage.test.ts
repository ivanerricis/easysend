import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { StorageResponse } from '@easysend/shared';
import { BYTES_PER_MB } from '@easysend/shared';
import { users } from '../src/db/schema/index.js';
import { bodyAs, errorCode } from './helpers.js';
import {
  createDraft,
  createUploadApp,
  filesOf,
  settle,
  uploadBytes,
  userWithClient,
} from './upload-helpers.js';
import { randomBytes } from 'node:crypto';

describe('GET /api/admin/storage', () => {
  it('reports disk usage, stored bytes and per-user figures', async () => {
    const total = 1000 * BYTES_PER_MB;
    const free = 300 * BYTES_PER_MB;
    const t = await createUploadApp({
      deps: { diskSpace: () => Promise.resolve({ totalBytes: total, freeBytes: free }) },
    });
    t.ctx.settings.set('general', { defaultLocale: 'it', diskReserveMb: 100, chunkSizeMb: 25 });
    const { user, client } = await userWithClient(t, { role: 'admin', email: 'boss@example.com' });
    const { user: other } = await userWithClient(t, { email: 'ann@example.com' });
    t.db.db.update(users).set({ quotaBytes: 5000 }).where(eq(users.id, other.id)).run();

    const active = await createDraft(client);
    await uploadBytes(t, client, { transferId: active.id, data: randomBytes(4000) });
    await settle(t);
    await client.post(`/api/transfers/${active.id}/finalize`);
    await createDraft(client); // a draft is not an active transfer

    const res = await client.get('/api/admin/storage');
    expect(res.status).toBe(200);
    const body = bodyAs<StorageResponse>(res);
    expect(body.disk).toEqual({
      totalBytes: total,
      freeBytes: free,
      reserveBytes: 100 * BYTES_PER_MB,
      usableBytes: 200 * BYTES_PER_MB,
    });
    expect(body.storedBytes).toBe(filesOf(t, active.id)[0]!.storedSizeBytes);
    expect(body.storedBytes).toBeGreaterThan(4000);
    expect(body.activeTransfers).toBe(1);
    expect(body.totalFiles).toBe(1);
    expect(body.users).toEqual([
      { userId: other.id, email: 'ann@example.com', usedBytes: 0, quotaBytes: 5000 },
      { userId: user.id, email: 'boss@example.com', usedBytes: 4000, quotaBytes: null },
    ]);
  });

  it('floors the usable space at zero and excludes expired transfers', async () => {
    const t = await createUploadApp({
      deps: {
        diskSpace: () =>
          Promise.resolve({ totalBytes: 100 * BYTES_PER_MB, freeBytes: BYTES_PER_MB }),
      },
    });
    t.ctx.settings.set('general', { defaultLocale: 'it', diskReserveMb: 50, chunkSizeMb: 25 });
    const { client } = await userWithClient(t, { role: 'admin' });
    const body = bodyAs<StorageResponse>(await client.get('/api/admin/storage'));
    expect(body.disk.usableBytes).toBe(0);
    expect(body.activeTransfers).toBe(0);
  });

  it('is admin only', async () => {
    const t = await createUploadApp();
    const { client } = await userWithClient(t);
    const res = await client.get('/api/admin/storage');
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect((await t.client().get('/api/admin/storage')).status).toBe(401);
  });
});
