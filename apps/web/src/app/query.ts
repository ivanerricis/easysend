import { QueryClient } from '@tanstack/react-query';
import { isApiError } from '@/lib/api/client';

/** No retry on 4xx (the answer will not change), at most one retry otherwise. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: false, staleTime: 15_000 },
      mutations: { retry: false },
    },
  });
}

/** Query key factory. Invalidate with a prefix, e.g. `queryKeys.transfers.all`. */
export const queryKeys = {
  session: ['session'] as const,
  publicSettings: ['public-settings'] as const,
  me: ['me'] as const,
  config: ['config'] as const,
  transfers: {
    all: ['transfers'] as const,
    list: (query?: object) => ['transfers', 'list', query ?? {}] as const,
    detail: (id: string) => ['transfers', 'detail', id] as const,
    downloads: (id: string, query?: object) => ['transfers', 'downloads', id, query ?? {}] as const,
  },
  admin: {
    users: (query?: object) => ['admin', 'users', query ?? {}] as const,
    user: (id: string) => ['admin', 'users', 'detail', id] as const,
    transfers: (query?: object) => ['admin', 'transfers', query ?? {}] as const,
    storage: ['admin', 'storage'] as const,
    settings: ['admin', 'settings'] as const,
    tunnel: ['admin', 'tunnel'] as const,
  },
  setup: {
    status: ['setup', 'status'] as const,
    smtp: ['setup', 'smtp'] as const,
  },
  download: (token: string) => ['download', token] as const,
};
