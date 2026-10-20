import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { useSession } from '@/app/providers/SessionProvider';
import { ErrorState, LoadingState } from '@/components/common/States';
import { configureApiClient } from '@/lib/api/client';
import NotFoundPage from '@/pages/NotFoundPage';

/** Public routes where an expired-session redirect would be pointless or loop. */
const NO_REDIRECT_PATHS = ['/login', '/forgot-password', '/reset-password', '/welcome', '/setup'];

/** Builds `/login?returnTo=<path>` for the current location. */
export function loginPath(returnTo: string): string {
  return returnTo && returnTo !== '/'
    ? `/login?returnTo=${encodeURIComponent(returnTo)}`
    : '/login';
}

/** Registers the API client hooks (setup required, session expired) with the router. */
export function ApiHooksBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const current = useRef(location);

  useEffect(() => {
    current.current = location;
  }, [location]);

  useEffect(() => {
    configureApiClient({
      onSetupRequired: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.publicSettings });
        void navigate('/setup', { replace: true });
      },
      onUnauthenticated: () => {
        queryClient.setQueryData(queryKeys.session, null);
        const { pathname, search } = current.current;
        if (NO_REDIRECT_PATHS.some((p) => pathname.startsWith(p)) || pathname.startsWith('/d/')) {
          return;
        }
        void navigate(loginPath(pathname + search), { replace: true });
      },
    });
    return () => configureApiClient({});
  }, [navigate, queryClient]);

  return null;
}

/**
 * Root route element: waits for the public settings, then enforces the setup gate. While the
 * setup is incomplete every route except `/setup` redirects to it; once complete, `/setup`
 * redirects home.
 */
export function SetupGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { settings, isLoading, error, refresh } = useAppearance();
  const { pathname } = useLocation();

  if (isLoading)
    return <LoadingState label={t('common.states.loadingPage')} className="min-h-dvh" />;
  if (!settings) return <ErrorState error={error} onRetry={() => void refresh()} />;

  const onSetup = pathname === '/setup' || pathname.startsWith('/setup/');
  if (!settings.setupCompleted && !onSetup) return <Navigate to="/setup" replace />;
  if (settings.setupCompleted && onSetup) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Layout-route guard: anonymous visitors go to `/login?returnTo=<current path>`. */
export function RequireAuth() {
  const { t } = useTranslation();
  const { user, isLoading } = useSession();
  const location = useLocation();
  if (isLoading)
    return <LoadingState label={t('common.states.loadingPage')} className="min-h-dvh" />;
  if (!user) {
    return <Navigate to={loginPath(location.pathname + location.search)} replace />;
  }
  return <Outlet />;
}

/** Layout-route guard (inside `RequireAuth`): non-admins see the 404 page, not a 403. */
export function RequireAdmin() {
  const { isAdmin } = useSession();
  return isAdmin ? <Outlet /> : <NotFoundPage />;
}
