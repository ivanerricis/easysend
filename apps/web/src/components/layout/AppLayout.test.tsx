import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeAdmin, makeUser, renderApp } from '@/test/render';

const status = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  currentVersion: '0.1.0',
  latestVersion: '0.2.0',
  updateAvailable: true,
  releaseUrl: 'https://github.com/ivanerricis/easysend/releases/tag/v0.2.0',
  publishedAt: 1_790_000_000,
  checkedAt: 1_790_000_100,
  availableVersions: [],
  status: 'ok',
  ...overrides,
});

describe('update notice in the sidebar', () => {
  it('links admins to the updates settings when a release is available', async () => {
    const { api } = renderApp({
      route: '/transfers',
      session: makeAdmin(),
      routes: { 'GET /api/admin/updates': status() },
    });
    const link = await screen.findByRole('link', { name: /^Update available:\s*0\.2\.0$/ });
    expect(link).toHaveAttribute('href', '/admin/settings/updates');
    expect(api.callsTo('GET /api/admin/updates')).toHaveLength(1);
    expect(api.callsTo('GET /api/admin/updates')[0]?.query.has('refresh')).toBe(false);
  });

  it('shows nothing when the instance is up to date', async () => {
    const { api } = renderApp({
      route: '/transfers',
      session: makeAdmin(),
      routes: {
        'GET /api/admin/updates': status({ updateAvailable: false, latestVersion: '0.1.0' }),
      },
    });
    await waitFor(() => expect(api.callsTo('GET /api/admin/updates')).toHaveLength(1));
    expect(screen.queryByRole('link', { name: /Update available/ })).toBeNull();
  });

  it('stays silent when the check fails', async () => {
    const { api } = renderApp({ route: '/transfers', session: makeAdmin() });
    await waitFor(() => expect(api.callsTo('GET /api/admin/updates')).toHaveLength(1));
    expect(screen.queryByRole('link', { name: /Update available/ })).toBeNull();
  });

  it('never asks non-admins', async () => {
    const { api } = renderApp({
      route: '/transfers',
      session: makeUser(),
      routes: { 'GET /api/admin/updates': status() },
    });
    await screen.findByRole('heading', { level: 1 });
    expect(api.callsTo('GET /api/admin/updates')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: /Update available/ })).toBeNull();
  });
});

describe('settings submenu in the sidebar', () => {
  const settingsRoutes = {
    'GET /api/admin/settings': {
      general: { diskReserveMb: 1024, chunkSizeMb: 25, defaultLocale: 'en', updateCheck: true },
      smtp: null,
    },
  };

  it('is collapsed outside the settings and expands to the five sub-pages', async () => {
    renderApp({ route: '/transfers', session: makeAdmin() });
    const toggle = await screen.findByRole('button', { name: 'Settings' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const hrefs = ['General', 'Email', 'Cloudflare', 'Updates', 'File storage'].map((name) =>
      within(nav).getByRole('link', { name }).getAttribute('href'),
    );
    expect(hrefs).toEqual([
      '/admin/settings/general',
      '/admin/settings/email',
      '/admin/settings/cloudflare',
      '/admin/settings/updates',
      '/admin/settings/storage',
    ]);
  });

  it('opens by default under the settings and marks the current sub-page', async () => {
    renderApp({
      route: '/admin/settings/email',
      session: makeAdmin(),
      routes: settingsRoutes,
    });
    const toggle = await screen.findByRole('button', { name: 'Settings' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Email' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current');
  });

  it('redirects /admin/settings to the general page', async () => {
    const { router } = renderApp({
      route: '/admin/settings',
      session: makeAdmin(),
      routes: settingsRoutes,
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/settings/general'));
    expect(await screen.findByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
  });

  it('is not shown to non-admins', async () => {
    renderApp({ route: '/transfers', session: makeUser() });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });
});
