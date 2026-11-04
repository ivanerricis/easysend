import type {
  ListUploadRequestsQuery,
  ListUploadRequestsResponse,
  UpdateUploadRequest,
  UploadRequestDetail,
  createUploadRequestSchema,
} from '@easysend/shared';
import { createApi, type In } from './endpoint';

const api = createApi([
  'requests.list',
  'requests.create',
  'requests.get',
  'requests.update',
  'requests.revoke',
  'requests.delete',
] as const);

export const USED_ENDPOINTS = api.ids;

/** Input type of the create request (schema defaults optional). */
export type CreateUploadRequestInput = In<typeof createUploadRequestSchema>;

export function listUploadRequests(
  query: Partial<ListUploadRequestsQuery> = {},
): Promise<ListUploadRequestsResponse> {
  return api.call('requests.list', { query });
}

export function createUploadRequest(body: CreateUploadRequestInput): Promise<UploadRequestDetail> {
  return api.call('requests.create', { body });
}

export function getUploadRequest(id: string): Promise<UploadRequestDetail> {
  return api.call('requests.get', { params: { id } });
}

export function updateUploadRequest(
  id: string,
  body: UpdateUploadRequest,
): Promise<UploadRequestDetail> {
  return api.call('requests.update', { params: { id }, body });
}

export function revokeUploadRequest(id: string): Promise<UploadRequestDetail> {
  return api.call('requests.revoke', { params: { id } });
}

export function deleteUploadRequest(id: string): Promise<void> {
  return api.call('requests.delete', { params: { id } });
}
