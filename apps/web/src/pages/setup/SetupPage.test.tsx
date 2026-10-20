import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, makeAdmin, makePublicSettings, renderApp, TEST_CSRF } from '@/test/render';

type Steps = { admin: boolean; smtp: boolean; cloudflare: boolean; general: boolean };

function status(
  steps: Partial<Steps> = {},
  options: { codeVerified?: boolean; appMode?: 'local' | 'production' } = {},
) {
  const appMode = options.appMode ?? 'local';
  return {
    setupCompleted: false,
    appMode,
    codeVerified: options.codeVerified ?? true,
    steps: {
      admin: false,
      smtp: false,
      cloudflare: appMode === 'local',
      general: false,
      ...steps,
    },
  };
}

const SMTP_SUGGESTION = {
  smtp: {
    host: 'mailpit',
    port: 1025,
    security: 'none',
    fromEmail: 'no-reply@localhost.localdomain',
    fromName: 'EasySend',
    hasPassword: false,
  },
  verified: false,
};

function render(statusBody: ReturnType<typeof status>, routes: Record<string, unknown> = {}) {
  return renderApp({
    route: '/setup',
    publicSettings: { setupCompleted: false, appMode: statusBody.appMode },
    routes: { 'GET /api/setup/status': statusBody, ...routes },
  });
}

function currentStep() {
  const nav = screen.getByRole('navigation', { name: 'Setup progress' });
  return within(nav).getByRole('listitem', { current: 'step' });
}

async function waitForStep(name: string) {
  return screen.findByRole('heading', { level: 2, name });
}

describe('SetupPage resume', () => {
  it('starts from the setup code when the cookie is missing', async () => {
    render(status({}, { codeVerified: false }));
    await waitForStep('Enter the setup code');
    expect(currentStep()).toHaveTextContent('Setup code');
    expect(screen.getByText('docker compose -p easysend-local logs api')).toBeInTheDocument();
  });

  it('shows the production log command in production mode', async () => {
    render(status({}, { codeVerified: false, appMode: 'production' }));
    await waitForStep('Enter the setup code');
    expect(screen.getByText('docker compose logs api')).toBeInTheDocument();
  });

  it('resumes at the first step that is not done', async () => {
    render(status({ admin: true }), { 'GET /api/setup/smtp': SMTP_SUGGESTION });
    await waitForStep('Email server');
    const step = currentStep();
    expect(step).toHaveTextContent('Email');
    expect(step).toHaveTextContent('Current step');
    // Earlier steps are written as done, later ones as to do.
    const nav = screen.getByRole('navigation', { name: 'Setup progress' });
    expect(within(nav).getAllByText('Done')).toHaveLength(2);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('resumes at the summary when everything is done', async () => {
    render(status({ admin: true, smtp: true, general: true }));
    await waitForStep('Ready to finish');
  });
});

describe('setup code step', () => {
  const submit = (code: string) => {
    fireEvent.change(screen.getByLabelText(/Setup code/), { target: { value: code } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  };

  it('normalizes the code and moves on to the administrator step', async () => {
    const { api } = render(status({}, { codeVerified: false }), {
      'POST /api/setup/code': { ok: true },
    });
    await waitForStep('Enter the setup code');
    submit('abcd efgh 2345');
    await waitForStep('Create the administrator account');
    expect(api.callsTo('POST /api/setup/code')[0]?.body).toEqual({ code: 'ABCD-EFGH-2345' });
  });

  it('shows an inline error for a wrong code', async () => {
    render(status({}, { codeVerified: false }), {
      'POST /api/setup/code': apiError(401, 'SETUP_CODE_INVALID'),
    });
    await waitForStep('Enter the setup code');
    submit('AAAA-BBBB-CCCC');
    expect(await screen.findByText('This code is not correct. Check the log and try again.'));
    expect(screen.getByLabelText(/Setup code/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('tells that a new code was printed when the old one expired', async () => {
    render(status({}, { codeVerified: false }), {
      'POST /api/setup/code': apiError(410, 'SETUP_CODE_EXPIRED'),
    });
    await waitForStep('Enter the setup code');
    submit('AAAA-BBBB-CCCC');
    expect(await screen.findByText(/A new one has just been printed/)).toBeInTheDocument();
  });

  it('reports the waiting time when rate limited', async () => {
    render(status({}, { codeVerified: false }), {
      'POST /api/setup/code': {
        ...apiError(429, 'RATE_LIMITED'),
        headers: { 'Retry-After': '600' },
      },
    });
    await waitForStep('Enter the setup code');
    submit('AAAA-BBBB-CCCC');
    expect(await screen.findByText(/Try again in about 10 minutes/)).toBeInTheDocument();
  });

  it('goes to the sign-in page when the setup is already completed', async () => {
    let completed = false;
    const { router } = render(status({}, { codeVerified: false }), {
      'POST /api/setup/code': () => {
        completed = true;
        return apiError(409, 'SETUP_ALREADY_COMPLETED');
      },
      'GET /api/public/settings': () => makePublicSettings({ setupCompleted: completed }),
    });
    await waitForStep('Enter the setup code');
    submit('AAAA-BBBB-CCCC');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});

describe('administrator step', () => {
  const fillForm = () => {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'a-long-admin-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'a-long-admin-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  };

  it('enrols two-factor authentication and gates the next step on the recovery codes', async () => {
    const admin = makeAdmin({ email: 'admin@example.com' });
    const { api } = render(status(), {
      'POST /api/setup/admin': {
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/EasySend:admin?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      },
      'POST /api/setup/admin/verify': {
        status: 201,
        body: { user: admin, csrfToken: TEST_CSRF, recoveryCodes: ['aaaa-bbbb-cccc'] },
      },
      'GET /api/setup/smtp': SMTP_SUGGESTION,
    });
    await waitForStep('Create the administrator account');
    fillForm();
    await waitForStep('Set up two-factor authentication');
    expect(screen.getByRole('img', { name: /QR code/ })).toBeInTheDocument();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    expect(api.callsTo('POST /api/setup/admin')[0]?.body).toEqual({
      email: 'admin@example.com',
      password: 'a-long-admin-password',
    });

    fireEvent.change(screen.getByLabelText('3. Enter the 6-digit code shown by the app'), {
      target: { value: '123456' },
    });
    await waitForStep('Save your recovery codes');
    expect(screen.getByText('aaaa-bbbb-cccc')).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Continue' });
    expect(next).toBeDisabled();
    expect(api.callsTo('GET /api/setup/smtp')).toHaveLength(0);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(next);
    await waitForStep('Email server');
  });

  it('shows an error for a wrong authenticator code', async () => {
    render(status(), {
      'POST /api/setup/admin': {
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/EasySend:admin?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      },
      'POST /api/setup/admin/verify': apiError(401, 'INVALID_TOTP_CODE'),
    });
    await waitForStep('Create the administrator account');
    fillForm();
    await waitForStep('Set up two-factor authentication');
    fireEvent.change(screen.getByLabelText('3. Enter the 6-digit code shown by the app'), {
      target: { value: '000000' },
    });
    expect(await screen.findByText('The code is incorrect or has expired.')).toBeInTheDocument();
  });

  it('rejects mismatching passwords locally', async () => {
    const { api } = render(status());
    await waitForStep('Create the administrator account');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'a-long-admin-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'another-long-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findAllByText('The two passwords do not match.')).length).toBeGreaterThan(
      0,
    );
    expect(api.callsTo('POST /api/setup/admin')).toHaveLength(0);
  });

  it('moves on when an administrator already exists', async () => {
    render(status(), {
      'POST /api/setup/admin': apiError(409, 'CONFLICT'),
      'GET /api/setup/smtp': SMTP_SUGGESTION,
    });
    await waitForStep('Create the administrator account');
    fillForm();
    await waitForStep('Administrator already exists');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitForStep('Email server');
  });
});

describe('SMTP step', () => {
  async function openSmtp(routes: Record<string, unknown> = {}) {
    const result = render(status({ admin: true }), {
      'GET /api/setup/smtp': SMTP_SUGGESTION,
      ...routes,
    });
    await waitForStep('Email server');
    await screen.findByLabelText('Server');
    return result;
  }

  it('prefills Mailpit in local mode and explains it', async () => {
    await openSmtp();
    expect(screen.getByLabelText('Server')).toHaveValue('mailpit');
    expect(screen.getByLabelText('Port')).toHaveValue('1025');
    expect(screen.getByRole('radio', { name: /None/ })).toBeChecked();
    expect(screen.getByText('Local mode: Mailpit')).toBeInTheDocument();
  });

  it('enables saving only after a test of the current values', async () => {
    const { api } = await openSmtp({
      'POST /api/setup/smtp/test': { ok: true, sentTo: 'admin@example.com' },
      'PUT /api/setup/smtp': { ...SMTP_SUGGESTION.smtp },
    });
    const save = screen.getByRole('button', { name: 'Save and continue' });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(await screen.findByText('Test email sent')).toBeInTheDocument();
    expect(screen.getByText(/admin@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/http:\/\/localhost:8025/)).toBeInTheDocument();
    expect(save).toBeEnabled();
    expect(api.callsTo('POST /api/setup/smtp/test')[0]?.body).toMatchObject({
      host: 'mailpit',
      port: 1025,
      security: 'none',
      fromEmail: 'no-reply@localhost.localdomain',
    });

    // Any change invalidates the test.
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '2525' } });
    expect(save).toBeDisabled();
    expect(screen.getByText(/settings changed after the last test/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '1025' } });
    expect(save).toBeEnabled();
  });

  it('saves the tested settings and moves on (Cloudflare is skipped in local mode)', async () => {
    const { api } = await openSmtp({
      'POST /api/setup/smtp/test': { ok: true, sentTo: 'admin@example.com' },
      'PUT /api/setup/smtp': { ...SMTP_SUGGESTION.smtp },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    await screen.findByText('Test email sent');
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitForStep('Domain and Cloudflare tunnel');
    expect(api.callsTo('PUT /api/setup/smtp')).toHaveLength(1);
    expect(screen.getByText('Skipped in local mode')).toBeInTheDocument();
    expect(screen.getByText(/Administration > Settings > Domain and tunnel/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Cloudflare API token')).not.toBeInTheDocument();
    expect(currentStep()).toHaveTextContent('Domain');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitForStep('General settings');
    const nav = screen.getByRole('navigation', { name: 'Setup progress' });
    expect(within(nav).getByText('Skipped')).toBeInTheDocument();
  });

  it('shows the safe error code when the test fails', async () => {
    await openSmtp({
      'POST /api/setup/smtp/test': {
        status: 422,
        body: {
          error: {
            code: 'SMTP_TEST_FAILED',
            message: 'x',
            requestId: 'r',
            details: { reason: 'EAUTH' },
          },
        },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(await screen.findByText(/authentication failed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeDisabled();
  });

  it('handles SMTP_NOT_VERIFIED by asking for a new test', async () => {
    await openSmtp({
      'POST /api/setup/smtp/test': { ok: true, sentTo: 'admin@example.com' },
      'PUT /api/setup/smtp': apiError(409, 'SMTP_NOT_VERIFIED'),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    await screen.findByText('Test email sent');
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(
      await screen.findByText('Send a test email with these settings first, then save.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeDisabled();
  });
});

describe('Cloudflare step (production)', () => {
  const open = async (routes: Record<string, unknown> = {}) => {
    render(status({ admin: true, smtp: true }, { appMode: 'production' }), routes);
    await waitForStep('Domain and Cloudflare tunnel');
  };
  const fill = () => {
    fireEvent.change(screen.getByLabelText(/^Domain/), { target: { value: 'Example.com' } });
    fireEvent.change(screen.getByLabelText(/^Subdomain/), { target: { value: 'files' } });
    fireEvent.change(screen.getByLabelText('Cloudflare API token'), {
      target: { value: 'x'.repeat(40) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create tunnel' }));
  };

  it('links to the token page in a new tab and lists the permissions', async () => {
    await open();
    const link = screen.getByRole('link', { name: /Create a token on Cloudflare/ });
    expect(link).toHaveAttribute('href', 'https://dash.cloudflare.com/profile/api-tokens');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveTextContent('opens in a new tab');
    expect(screen.getByText('Account · Cloudflare Tunnel · Edit')).toBeInTheDocument();
  });

  it('creates the tunnel and shows the public address', async () => {
    await open({
      'POST /api/setup/cloudflare': {
        hostname: 'files.example.com',
        publicUrl: 'https://files.example.com',
        tunnelId: 't1',
      },
    });
    fill();
    await waitForStep('Tunnel created');
    expect(screen.getByText('https://files.example.com')).toBeInTheDocument();
  });

  it('shows specific guidance and allows a retry', async () => {
    await open({ 'POST /api/setup/cloudflare': apiError(409, 'CLOUDFLARE_RECORD_EXISTS') });
    fill();
    expect(
      await screen.findByText(
        'A DNS record with this name already exists. Choose another subdomain.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});

describe('general and complete steps', () => {
  it('saves the general settings with the shared schema', async () => {
    const { api } = render(status({ admin: true, smtp: true }), {
      'PUT /api/setup/general': { ok: true },
    });
    await waitForStep('General settings');
    fireEvent.change(screen.getByLabelText('Instance name'), { target: { value: 'My files' } });
    fireEvent.change(screen.getByLabelText('Upload chunk size (MB)'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findAllByText('The maximum value is 50.')).not.toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Upload chunk size (MB)'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitForStep('Ready to finish');
    expect(api.callsTo('PUT /api/setup/general')[0]?.body).toMatchObject({
      instanceName: 'My files',
      chunkSizeMb: 25,
      diskReserveMb: 1024,
      defaultLocale: 'en',
      defaultTheme: 'system',
    });
    expect(screen.getByText('My files')).toBeInTheDocument();
  });

  it('jumps to the missing step when the API lists unfinished steps', async () => {
    render(status({ admin: true, smtp: true, general: true }), {
      'POST /api/setup/complete': {
        status: 409,
        body: {
          error: {
            code: 'CONFLICT',
            message: 'x',
            requestId: 'r',
            details: { missing: ['smtp'] },
          },
        },
      },
      'GET /api/setup/smtp': SMTP_SUGGESTION,
    });
    await waitForStep('Ready to finish');
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    await waitForStep('Email server');
    expect(screen.getByText(/Some required steps are not finished yet: Email/)).toBeInTheDocument();
  });

  it('leaves the wizard after completing', async () => {
    let done = false;
    const { router, api } = render(status({ admin: true, smtp: true, general: true }), {
      'POST /api/setup/complete': () => {
        done = true;
        return { ok: true };
      },
      'GET /api/public/settings': () => makePublicSettings({ setupCompleted: done }),
    });
    await waitForStep('Ready to finish');
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    await waitFor(() => expect(router.state.location.pathname).not.toBe('/setup'));
    expect(api.callsTo('POST /api/setup/complete')).toHaveLength(1);
  });

  it('goes back to the code step when the setup session expires', async () => {
    render(status({ admin: true, smtp: true, general: true }), {
      'POST /api/setup/complete': apiError(401, 'UNAUTHENTICATED'),
    });
    await waitForStep('Ready to finish');
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    await waitForStep('Enter the setup code');
    expect(screen.getByText(/The setup session expired/)).toBeInTheDocument();
  });
});
