import type {
  AdminUser,
  CloudflareRequest,
  CloudflareResponse,
  DeleteUserQuery,
  ListUsersQuery,
  ListUsersResponse,
  StorageResponse,
  TunnelStatusResponse,
  UpdateStatusResponse,
  UpdateUserRequest,
  createUserRequestSchema,
} from '@easysend/shared';
import { createApi, type In } from './endpoint';

const api = createApi([
  'users.list',
  'users.create',
  'users.get',
  'users.update',
  'users.reset2fa',
  'users.delete',
  'admin.storage',
  'admin.tunnelGet',
  'admin.tunnelSet',
  'admin.updates',
] as const);

export const USED_ENDPOINTS = api.ids;

export type CreateUserInput = In<typeof createUserRequestSchema>;

export function listUsers(query: Partial<ListUsersQuery> = {}): Promise<ListUsersResponse> {
  return api.call('users.list', { query });
}

/** Creates a user; without a password the user receives a welcome link by email. */
export function createUser(body: CreateUserInput): Promise<AdminUser> {
  return api.call('users.create', { body });
}

export function getUser(id: string): Promise<AdminUser> {
  return api.call('users.get', { params: { id } });
}

export function updateUser(id: string, body: UpdateUserRequest): Promise<AdminUser> {
  return api.call('users.update', { params: { id }, body });
}

export function resetUser2fa(id: string): Promise<void> {
  return api.call('users.reset2fa', { params: { id } });
}

/** `transfers: 'reassign'` requires `reassignTo`. */
export function deleteUser(id: string, query: DeleteUserQuery): Promise<void> {
  return api.call('users.delete', { params: { id }, query });
}

/** Disk usage, free space and per-user usage. */
export function getStorage(): Promise<StorageResponse> {
  return api.call('admin.storage');
}

export function getTunnel(): Promise<TunnelStatusResponse> {
  return api.call('admin.tunnelGet');
}

/** Configures (or reconfigures) the Cloudflare tunnel. The API token is never stored. */
export function setTunnel(body: CloudflareRequest): Promise<CloudflareResponse> {
  return api.call('admin.tunnelSet', { body });
}

/**
 * Is a newer release available? `refresh` skips the server cache (limited to 10 per hour). The
 * server asks GitHub only when the "check for updates" setting is on.
 */
export function getUpdateStatus(refresh = false): Promise<UpdateStatusResponse> {
  return api.call('admin.updates', refresh ? { query: { refresh: true } } : {});
}
