import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, makeAdmin, renderWithProviders } from '@/test/render';
import SettingsPage from './SettingsPage';

const general = { diskReserveMb: 1024, chunkSizeMb: 25, defaultLocale: 'en' };

function renderPage(routes: Record<string, unknown> = {}) {
  return renderWithProviders(<SettingsPage />, {
    session: makeAdmin(),
    route: '/admin/settings',
    routes: {
      'GET /api/admin/settings': { general, smtp: null },
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
    });
  });
});
