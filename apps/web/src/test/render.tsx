import type { PublicSettingsResponse, User } from '@easysend/shared';
import { QueryClient } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router';
import { AppProviders } from '@/app/AppProviders';
import { appRoutes } from '@/app/router';
import { TEST_CSRF, makePublicSettings, mockApi, type MockApi, type MockRoutes } from './mock-api';

export interface RenderOptions {
  /** Initial URL (path + query). */
  route?: string;
  /** Logged-in user, or null / omitted for an anonymous visitor. Use `makeUser()` / `makeAdmin()`. */
  session?: User | null;
  /** Overrides of `GET /api/public/settings`. */
  publicSettings?: Partial<PublicSettingsResponse>;
  /** Extra API routes (keys `METHOD /api/path`); they win over the defaults. */
  routes?: MockRoutes;
}

export interface RenderResultWithApi extends RenderResult {
  api: MockApi;
  queryClient: QueryClient;
}

export interface RenderAppResult extends RenderResultWithApi {
  /** The memory router, e.g. `router.state.location.pathname` / `.search`. */
  router: ReturnType<typeof createMemoryRouter>;
}

function setupApi(options: RenderOptions): MockApi {
  const { session = null, publicSettings, routes } = options;
  return mockApi({
    'GET /api/auth/csrf': { csrfToken: TEST_CSRF },
    'GET /api/public/settings': makePublicSettings(publicSettings),
    'GET /api/auth/session': session
      ? { authenticated: true, user: session, csrfToken: TEST_CSRF }
      : { authenticated: false },
    'GET /api/me': { user: session, usedBytes: 0, quotaBytes: null },
    ...routes,
  });
}

function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
  });
}

/**
 * Renders `ui` inside the real providers (query client, appearance, session, theme, locale) and
 * a MemoryRouter, with `fetch` mocked by `mockApi`. Default API: CSRF, public settings, session
 * (from `options.session`) and `GET /api/me`; add or override routes with `options.routes`.
 *
 * @example
 * const { api } = renderWithProviders(<ProfilePage />, {
 *   session: makeUser(),
 *   routes: { 'PATCH /api/me': { user: makeUser({ displayName: 'Ada' }), usedBytes: 0, quotaBytes: null } },
 * });
 * await screen.findByRole('heading', { level: 1 });
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions = {},
): RenderResultWithApi {
  const api = setupApi(options);
  const queryClient = newQueryClient();
  const result = render(
    <AppProviders queryClient={queryClient}>
      <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
    </AppProviders>,
  );
  return { ...result, api, queryClient };
}

/**
 * Renders the whole application (real route table, guards, layouts) at `options.route`.
 * Pages are lazy: use `findBy...` queries.
 */
export function renderApp(options: RenderOptions = {}): RenderAppResult {
  const api = setupApi(options);
  const queryClient = newQueryClient();
  const router = createMemoryRouter(appRoutes, { initialEntries: [options.route ?? '/'] });
  const result = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...result, api, queryClient, router };
}

export { makeAdmin, makeUser, makePublicSettings, mockApi, apiError, TEST_CSRF } from './mock-api';
