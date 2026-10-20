import type {
  AdminListTransfersQuery,
  ListDownloadLogsResponse,
  ListTransfersQuery,
  ListTransfersResponse,
  PaginationQuery,
  TransferDetail,
  UpdateTransferRequest,
  createTransferRequestSchema,
} from '@easysend/shared';
import { createApi, type In } from './endpoint';

const api = createApi([
  'transfers.create',
  'transfers.finalize',
  'transfers.list',
  'transfers.get',
  'transfers.update',
  'transfers.revoke',
  'transfers.resend',
  'transfers.delete',
  'transfers.deleteFile',
  'transfers.downloads',
  'transfers.adminList',
] as const);

export const USED_ENDPOINTS = api.ids;

/** Input type of the create request (schema defaults optional). */
export type CreateTransferInput = In<typeof createTransferRequestSchema>;

/** Creates a draft transfer (status `uploading`); upload files with tus, then `finalizeTransfer`. */
export function createTransfer(body: CreateTransferInput): Promise<TransferDetail> {
  return api.call('transfers.create', { body });
}

/** Activates the transfer and sends the emails. */
export function finalizeTransfer(id: string): Promise<TransferDetail> {
  return api.call('transfers.finalize', { params: { id } });
}

export function listTransfers(
  query: Partial<ListTransfersQuery> = {},
): Promise<ListTransfersResponse> {
  return api.call('transfers.list', { query });
}

export function getTransfer(id: string): Promise<TransferDetail> {
  return api.call('transfers.get', { params: { id } });
}

export function updateTransfer(id: string, body: UpdateTransferRequest): Promise<TransferDetail> {
  return api.call('transfers.update', { params: { id }, body });
}

export function revokeTransfer(id: string): Promise<TransferDetail> {
  return api.call('transfers.revoke', { params: { id } });
}

/** Sends the notification emails again (rate limited). */
export function resendTransfer(id: string): Promise<TransferDetail> {
  return api.call('transfers.resend', { params: { id } });
}

export function deleteTransfer(id: string): Promise<void> {
  return api.call('transfers.delete', { params: { id } });
}

export function deleteTransferFile(id: string, fileId: string): Promise<void> {
  return api.call('transfers.deleteFile', { params: { id, fileId } });
}

export function listTransferDownloads(
  id: string,
  query: Partial<PaginationQuery> = {},
): Promise<ListDownloadLogsResponse> {
  return api.call('transfers.downloads', { params: { id }, query });
}

/** Admin: every transfer, optionally filtered by `ownerId`. */
export function adminListTransfers(
  query: Partial<AdminListTransfersQuery> = {},
): Promise<ListTransfersResponse> {
  return api.call('transfers.adminList', { query });
}
