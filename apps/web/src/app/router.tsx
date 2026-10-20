import { lazy } from 'react';
import { Navigate, Outlet, createBrowserRouter, type RouteObject } from 'react-router';
import { ApiHooksBridge, RequireAdmin, RequireAuth, SetupGate } from '@/app/guards';
import { useSession } from '@/app/providers/SessionProvider';
import { AppLayout } from '@/components/layout/AppLayout';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { Toaster } from '@/components/ui/sonner';
import NotFoundPage from '@/pages/NotFoundPage';

const SetupPage = lazy(() => import('@/pages/setup/SetupPage'));
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'));
const WelcomePage = lazy(() => import('@/pages/auth/WelcomePage'));
const DownloadPage = lazy(() => import('@/pages/download/DownloadPage'));
const NewTransferPage = lazy(() => import('@/pages/transfers/NewTransferPage'));
const TransfersPage = lazy(() => import('@/pages/transfers/TransfersPage'));
const TransferDetailPage = lazy(() => import('@/pages/transfers/TransferDetailPage'));
const ProfilePage = lazy(() => import('@/pages/profile/ProfilePage'));
const UsersPage = lazy(() => import('@/pages/admin/UsersPage'));
const AdminTransfersPage = lazy(() => import('@/pages/admin/AdminTransfersPage'));
const StoragePage = lazy(() => import('@/pages/admin/StoragePage'));
const SettingsPage = lazy(() => import('@/pages/admin/SettingsPage'));
const AppearancePage = lazy(() => import('@/pages/admin/AppearancePage'));

/** Root element: API hooks, setup gate, the routed page and the toast region. */
function RootRoute() {
  return (
    <>
      <ApiHooksBridge />
      <SetupGate>
        <Outlet />
      </SetupGate>
      <Toaster />
    </>
  );
}

/** Unknown URLs: inside the app shell for logged-in users, the public layout otherwise. */
function NotFoundRoute() {
  const { user } = useSession();
  return user ? (
    <AppLayout>
      <NotFoundPage />
    </AppLayout>
  ) : (
    <PublicLayout>
      <NotFoundPage />
    </PublicLayout>
  );
}

/** Route table, exported so tests can mount it in a memory router. */
export const appRoutes: RouteObject[] = [
  {
    element: <RootRoute />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { path: 'setup', element: <SetupPage /> },
          { path: 'login', element: <LoginPage /> },
          { path: 'forgot-password', element: <ForgotPasswordPage /> },
          { path: 'reset-password', element: <ResetPasswordPage /> },
          { path: 'welcome', element: <WelcomePage /> },
          { path: 'd/:token', element: <DownloadPage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <NewTransferPage /> },
              { path: 'transfers', element: <TransfersPage /> },
              { path: 'transfers/:id', element: <TransferDetailPage /> },
              { path: 'profile', element: <ProfilePage /> },
              {
                element: <RequireAdmin />,
                children: [
                  { path: 'admin', element: <Navigate to="/admin/users" replace /> },
                  { path: 'admin/users', element: <UsersPage /> },
                  { path: 'admin/transfers', element: <AdminTransfersPage /> },
                  { path: 'admin/storage', element: <StoragePage /> },
                  { path: 'admin/settings', element: <SettingsPage /> },
                  { path: 'admin/appearance', element: <AppearancePage /> },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundRoute /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
