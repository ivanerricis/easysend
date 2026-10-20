import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeAdmin, makeUser, renderApp } from '@/test/render';

describe('route guards', () => {
  it('sends everything to /setup while the setup is incomplete', async () => {
    const { router } = renderApp({
      route: '/transfers',
      publicSettings: { setupCompleted: false },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Setup' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
  });

  it('redirects /setup to the app once the setup is complete', async () => {
    const { router } = renderApp({ route: '/setup', session: makeUser() });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Send files' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('sends anonymous visitors to /login with returnTo', async () => {
    const { router } = renderApp({ route: '/transfers' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?returnTo=%2Ftransfers');
  });

  it('shows the 404 page to non-admins on admin routes', async () => {
    renderApp({ route: '/admin/users', session: makeUser() });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
  });

  it('lets admins in and redirects /admin to the users page', async () => {
    const { router } = renderApp({ route: '/admin', session: makeAdmin() });
    expect(await screen.findByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/users');
  });

  it('renders the public download route without a session', async () => {
    renderApp({ route: '/d/some-token' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Download files' }),
    ).toBeInTheDocument();
  });

  it('shows the 404 page for unknown URLs', async () => {
    renderApp({ route: '/nope' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
  });
});

describe('app layout', () => {
  it('shows the admin group only to admins', async () => {
    const user = renderApp({ route: '/transfers', session: makeUser() });
    await screen.findByRole('heading', { level: 1, name: 'Transfers' });
    expect(screen.getByRole('link', { name: 'Send' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Appearance' })).not.toBeInTheDocument();
    user.unmount();

    renderApp({ route: '/transfers', session: makeAdmin() });
    await screen.findByRole('heading', { level: 1, name: 'Transfers' });
    for (const name of ['Users', 'All transfers', 'Storage', 'Settings', 'Appearance']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('marks the active link with aria-current and has landmarks', async () => {
    renderApp({ route: '/transfers', session: makeUser() });
    await screen.findByRole('heading', { level: 1, name: 'Transfers' });
    const active = screen.getByRole('link', { name: 'Transfers' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Send' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus());
  });
});
