import type { AdminUser, StorageResponse } from '@easysend/shared';
import { makeAdmin, makeUser } from '@/test/mock-api';

/** Test factory for an admin-list user (adds the usage fields to the base factory). */
export function makeAdminListUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    ...makeUser(),
    disabled: false,
    usedBytes: 0,
    quotaBytes: null,
    transferCount: 0,
    ...overrides,
  };
}

export function makeAdminListAdmin(overrides: Partial<AdminUser> = {}): AdminUser {
  return { ...makeAdminListUser(), ...makeAdmin(), ...overrides };
}

export function userList(items: AdminUser[]) {
  return { items, total: items.length, page: 1, pageSize: 20 };
}

export function makeStorage(overrides: Partial<StorageResponse> = {}): StorageResponse {
  const gib = 1024 ** 3;
  return {
    disk: {
      totalBytes: 100 * gib,
      freeBytes: 60 * gib,
      reserveBytes: 5 * gib,
      usableBytes: 55 * gib,
    },
    storedBytes: 10 * gib,
    activeTransfers: 7,
    totalFiles: 42,
    users: [
      { userId: 'u1', email: 'small@example.com', usedBytes: 1 * gib, quotaBytes: 10 * gib },
      { userId: 'u2', email: 'big@example.com', usedBytes: 8 * gib, quotaBytes: null },
    ],
    ...overrides,
  };
}
