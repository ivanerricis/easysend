import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/app/query';
import { getUpdateStatus } from '@/lib/api/admin';

/** The server caches the answer for 24 h, so the browser asks again at most once an hour. */
export const UPDATE_STATUS_STALE_MS = 60 * 60 * 1000;

/**
 * Update status for admins. `enabled` must be false for everyone else: the endpoint is
 * admin-only. A failed request is not retried and leaves `data` undefined (no notice).
 */
export function useUpdateStatus(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.updates,
    queryFn: () => getUpdateStatus(),
    enabled,
    staleTime: UPDATE_STATUS_STALE_MS,
    retry: false,
  });
}
