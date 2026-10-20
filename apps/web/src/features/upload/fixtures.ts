import type { TransferDetail, TransferSummary } from '@easysend/shared';

/** Test factories shared by the upload and transfer page tests. */
export function makeTransferDetail(overrides: Partial<TransferDetail> = {}): TransferDetail {
  return {
    id: 't1',
    title: 'Holiday photos',
    mode: 'link',
    status: 'active',
    ownerId: 'user-1',
    ownerEmail: 'user@example.com',
    createdAt: 1_700_000_000,
    expiresAt: 4_100_000_000,
    totalBytes: 2048,
    fileCount: 1,
    recipientCount: 0,
    downloadCount: 2,
    maxDownloads: 10,
    hasPassword: false,
    message: null,
    shareUrl: 'http://localhost:8080/d/abc123',
    firstDownloadedAt: null,
    files: [
      {
        id: 'f1',
        name: 'photo.jpg',
        sizeBytes: 2048,
        mimeType: 'image/jpeg',
        sha256: 'a'.repeat(64),
        createdAt: 1_700_000_000,
      },
    ],
    recipients: [],
    uploads: [],
    ...overrides,
  };
}

export function makeTransferSummary(overrides: Partial<TransferSummary> = {}): TransferSummary {
  const { id, title, mode, status, ownerId, ownerEmail, createdAt, expiresAt } =
    makeTransferDetail();
  return {
    id,
    title,
    mode,
    status,
    ownerId,
    ownerEmail,
    createdAt,
    expiresAt,
    totalBytes: 2048,
    fileCount: 1,
    recipientCount: 0,
    downloadCount: 2,
    maxDownloads: 10,
    hasPassword: false,
    ...overrides,
  };
}
