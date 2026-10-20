import type { User } from '@easysend/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { queryKeys } from '@/app/query';
import { logout as apiLogout, getSession } from '@/lib/api/auth';

export interface SessionContextValue {
  /** Logged-in user, or null for an anonymous visitor. */
  user: User | null;
  /** True until the first `GET /api/auth/session` answer. */
  isLoading: boolean;
  isAdmin: boolean;
  /** Re-reads the session from the server. */
  refresh: () => Promise<void>;
  /** Overwrites the cached user (after login, profile edits); `null` clears the session. */
  setSessionUser: (user: User | null) => void;
  /** Ends the session on the server and clears per-user caches. */
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Session state backed by the `session` query (data: `User | null`). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.session,
    queryFn: async (): Promise<User | null> => {
      const data = await getSession();
      return data.authenticated ? data.user : null;
    },
    staleTime: Infinity,
  });

  const user = query.data ?? null;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.session });
  }, [queryClient]);

  const setSessionUser = useCallback(
    (next: User | null) => {
      queryClient.setQueryData<User | null>(queryKeys.session, next);
      if (!next) {
        // Drop everything user specific; keep the session itself and the public settings.
        queryClient.removeQueries({
          predicate: (q) =>
            q.queryKey[0] !== queryKeys.session[0] && q.queryKey[0] !== queryKeys.publicSettings[0],
        });
      }
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setSessionUser(null);
    }
  }, [setSessionUser]);

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      isLoading: query.isPending,
      isAdmin: user?.role === 'admin',
      refresh,
      setSessionUser,
      logout,
    }),
    [user, query.isPending, refresh, setSessionUser, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider');
  return value;
}
