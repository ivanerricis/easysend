import type { UpdateRunResponse } from '@easysend/shared';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/app/query';
import { getUpdateRun } from '@/lib/api/admin';
import { isApiError } from '@/lib/api/client';

/** How often the state of a running update is read. */
export const UPDATE_RUN_POLL_MS = 2000;

/** An update is waiting for the host runner or is being run by it. */
export function isUpdateActive(data: UpdateRunResponse | undefined): boolean {
  return Boolean(data?.pending) || data?.run?.state === 'running';
}

/**
 * State of the one-click update for admins. While an update is active the query polls every 2 s
 * and keeps polling across the restart of the API and web containers: a `SERVICE_UNAVAILABLE`
 * failure leaves the last data in place and only sets `restarting`. The request skips the global
 * 401 redirect; `signedOut` tells the page to ask the admin to sign in again.
 */
export function useUpdateRun(enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.admin.updateRun,
    queryFn: () => getUpdateRun(),
    enabled,
    retry: false,
    staleTime: 0,
    refetchInterval: (state) => (isUpdateActive(state.state.data) ? UPDATE_RUN_POLL_MS : false),
  });
  const active = isUpdateActive(query.data);
  const error = query.error;
  return {
    data: query.data,
    isPending: query.isPending,
    /** The first read failed (no data to show). */
    isError: query.isError && query.data === undefined,
    active,
    restarting: active && isApiError(error) && error.code === 'SERVICE_UNAVAILABLE',
    signedOut: active && isApiError(error) && error.status === 401,
  };
}
