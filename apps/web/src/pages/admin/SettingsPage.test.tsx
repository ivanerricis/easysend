import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, makeAdmin, renderWithProviders } from '@/test/render';
import SettingsPage from './SettingsPage';

const general = { diskReserveMb: 1024, chunkSizeMb: 25, defaultLocale: 'en', updateCheck: true };

const updateStatus = (overrides: Record<string, unknown> = {}) => ({
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

function renderPage(routes: Record<string, unknown> = {}) {
  return renderWithProviders(<SettingsPage />, {
    session: makeAdmin(),
    route: '/admin/settings',
    routes: {
      'GET /api/admin/settings': { general, smtp: null },
      'GET /api/admin/updates': updateStatus(),
      'GET /api/admin/tunnel': {
        appMode: 'local',
        configured: false,
        hostname: null,
        publicUrl: null,
        tunnelId: null,
        configuredAt: null,
      },
      ...routes,
    },
  });
}

async function fillSmtp(host = 'smtp.example.com') {
  const hostInput = await screen.findByLabelText('Server');
  fireEvent.change(hostInput, { target: { value: host } });
  fireEvent.change(screen.getByLabelText('Sender email'), {
    target: { value: 'noreply@example.com' },
  });
}

describe('SettingsPage', () => {
  it('keeps Save disabled until a test succeeds and disables it again after an edit', async () => {
    const { api } = renderPage({
      'POST /api/admin/settings/smtp/test': { ok: true, sentTo: 'admin@example.com' },
      'PUT /api/admin/settings/smtp': {
        host: 'smtp.example.com',
        port: 587,
        security: 'starttls',
        fromEmail: 'noreply@example.com',
        hasPassword: false,
      },
    });
    await fillSmtp();
    const save = screen.getAllByRole('button', { name: 'Save' }).at(-1)!;
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(await screen.findByText(/Test email sent to admin@example.com/)).toBeInTheDocument();
    expect(save).toBeEnabled();
    expect(api.callsTo('POST /api/admin/settings/smtp/test')[0]?.body).toMatchObject({
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
      fromEmail: 'noreply@example.com',
    });

    // Any edit invalidates the test.
    fireEvent.change(screen.getByLabelText('Server'), { target: { value: 'smtp2.example.com' } });
    await waitFor(() => expect(save).toBeDisabled());
    expect(screen.queryByText(/Test email sent to/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(api.callsTo('PUT /api/admin/settings/smtp')).toHaveLength(1));
    expect(api.callsTo('PUT /api/admin/settings/smtp')[0]?.body).not.toHaveProperty('password');
  });

  it('shows the safe reason when the test email fails', async () => {
    renderPage({
      'POST /api/admin/settings/smtp/test': {
        status: 422,
        body: {
          error: {
            code: 'SMTP_TEST_FAILED',
            message: 'failed',
            requestId: 'r1',
            details: { reason: 'ECONNREFUSED' },
          },
        },
      },
    });
    await fillSmtp();
    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(await screen.findByText(/code ECONNREFUSED/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Save' }).at(-1)).toBeDisabled();
  });

  it('shows a rate limit error from the test', async () => {
    renderPage({ 'POST /api/admin/settings/smtp/test': apiError(429, 'RATE_LIMITED') });
    await fillSmtp();
    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(await screen.findByText(/Too many requests/)).toBeInTheDocument();
  });

  it('disables the tunnel form in local mode', async () => {
    renderPage();
    expect(await screen.findByText('Cloudflare is not used in local mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Domain')).toBeDisabled();
    expect(screen.getByLabelText('Cloudflare API token')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Configure tunnel' })).toBeDisabled();
  });

  it('enables the tunnel form in production and maps Cloudflare errors to fields', async () => {
    const { api } = renderPage({
      'GET /api/admin/tunnel': {
        appMode: 'production',
        configured: false,
        hostname: null,
        publicUrl: null,
        tunnelId: null,
        configuredAt: null,
      },
      'POST /api/admin/tunnel': apiError(409, 'CLOUDFLARE_RECORD_EXISTS'),
    });
    const domain = await screen.findByLabelText('Domain');
    expect(domain).toBeEnabled();
    fireEvent.change(domain, { target: { value: 'example.com' } });
    fireEvent.change(screen.getByLabelText(/Subdomain/), { target: { value: 'send' } });
    fireEvent.change(screen.getByLabelText('Cloudflare API token'), {
      target: { value: 'a'.repeat(40) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Configure tunnel' }));
    await waitFor(() => expect(api.callsTo('POST /api/admin/tunnel')).toHaveLength(1));
    expect(api.callsTo('POST /api/admin/tunnel')[0]?.body).toMatchObject({
      domain: 'example.com',
      subdomain: 'send',
    });
    await waitFor(() =>
      expect(screen.getByLabelText(/Subdomain/)).toHaveAttribute('aria-invalid', 'true'),
    );
    // The token is never kept after an attempt.
    expect(screen.getByLabelText('Cloudflare API token')).toHaveValue('');
  });

  it('saves the general settings', async () => {
    const { api } = renderPage({
      'PATCH /api/admin/settings': {
        general: { ...general, chunkSizeMb: 40 },
        smtp: null,
      },
    });
    const chunk = await screen.findByLabelText('Upload chunk size (MB)');
    fireEvent.change(chunk, { target: { value: '40' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    await waitFor(() => expect(api.callsTo('PATCH /api/admin/settings')).toHaveLength(1));
    expect(api.callsTo('PATCH /api/admin/settings')[0]?.body).toEqual({
      diskReserveMb: 1024,
      chunkSizeMb: 40,
      defaultLocale: 'en',
      updateCheck: true,
    });
  });

  it('turns the update check off with the switch', async () => {
    const { api } = renderPage({
      'PATCH /api/admin/settings': {
        general: { ...general, updateCheck: false },
        smtp: null,
      },
    });
    const toggle = await screen.findByRole('switch', { name: 'Check for updates' });
    expect(toggle).toBeChecked();
    expect(
      screen.getByText(/Once a day the server asks GitHub for the latest published version/),
    ).toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    await waitFor(() => expect(api.callsTo('PATCH /api/admin/settings')).toHaveLength(1));
    expect(api.callsTo('PATCH /api/admin/settings')[0]?.body).toMatchObject({ updateCheck: false });
  });
});

type MockRequest = { query: URLSearchParams };

describe('SettingsPage: updates section', () => {
  it('shows versions, release notes and the update commands', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Updates' })).toBeInTheDocument();
    expect(await screen.findByText('Update available')).toBeInTheDocument();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('0.2.0')).toBeInTheDocument();
    const notes = screen.getByRole('link', { name: /Release notes/ });
    expect(notes).toHaveAttribute(
      'href',
      'https://github.com/ivanerricis/easysend/releases/tag/v0.2.0',
    );
    expect(notes).toHaveAttribute('rel', 'noopener noreferrer');
    const commands = screen.getByLabelText('Commands to run on the server');
    expect(commands).toHaveTextContent('cd /opt/easysend');
    expect(commands).toHaveTextContent('./scripts/deploy.sh 0.2.0');
    expect(screen.getByRole('link', { name: /Update guide/ })).toHaveAttribute(
      'href',
      'https://ivanerricis.github.io/easysend/guide/updates',
    );
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('says it is up to date and hides the commands', async () => {
    renderPage({
      'GET /api/admin/updates': updateStatus({ updateAvailable: false, latestVersion: '0.1.0' }),
    });
    expect(await screen.findByText('Up to date')).toBeInTheDocument();
    expect(screen.queryByLabelText('Commands to run on the server')).toBeNull();
  });

  it('explains a turned-off check and disables Check now', async () => {
    renderPage({
      'GET /api/admin/updates': updateStatus({
        enabled: false,
        status: 'disabled',
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        publishedAt: null,
        checkedAt: null,
      }),
    });
    expect(await screen.findByText('Check turned off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled();
  });

  it('reports an unreachable GitHub', async () => {
    renderPage({
      'GET /api/admin/updates': updateStatus({
        status: 'unavailable',
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        publishedAt: null,
      }),
    });
    expect(await screen.findByText('GitHub is not reachable')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Release notes/ })).toBeNull();
  });

  it('notes that a development build is not compared', async () => {
    renderPage({
      'GET /api/admin/updates': updateStatus({
        currentVersion: '0.0.0-dev',
        updateAvailable: false,
      }),
    });
    expect(await screen.findByText(/not a release number/)).toBeInTheDocument();
  });

  it('forces a new check with Check now', async () => {
    const { api } = renderPage({
      'GET /api/admin/updates': (request: MockRequest) =>
        request.query.get('refresh') === 'true'
          ? updateStatus({ latestVersion: '0.3.0' })
          : updateStatus(),
    });
    await screen.findByText('0.2.0');
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText('0.3.0')).toBeInTheDocument();
    expect(api.callsTo('GET /api/admin/updates').at(-1)?.query.get('refresh')).toBe('true');
  });

  it('shows the rate limit error of Check now', async () => {
    renderPage({
      'GET /api/admin/updates': (request: MockRequest) =>
        request.query.get('refresh') === 'true' ? apiError(429, 'RATE_LIMITED') : updateStatus(),
    });
    await screen.findByText('0.2.0');
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect((await screen.findAllByText(/Too many requests/)).length).toBeGreaterThan(0);
  });
});
