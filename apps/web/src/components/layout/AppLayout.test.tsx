import { screen, waitFor } from '@testing-library/react';
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
    const link = await screen.findByRole('link', { name: /Update available: 0\.2\.0/ });
    expect(link).toHaveAttribute('href', '/admin/settings#settings-updates');
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
