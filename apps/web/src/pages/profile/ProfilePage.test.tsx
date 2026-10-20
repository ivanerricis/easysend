import type { User } from '@easysend/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  makeAdmin,
  makeUser,
  renderWithProviders,
  type RenderOptions,
} from '@/test/render';
import type { MockRequest } from '@/test/mock-api';
import ProfilePage from './ProfilePage';

type Routes = NonNullable<RenderOptions['routes']>;

function me(user: User, extra: Record<string, unknown> = {}) {
  return { user, usedBytes: 1_048_576, quotaBytes: null, ...extra };
}

function renderProfile(user: User, routes: Routes = {}) {
  return renderWithProviders(<ProfilePage />, {
    session: user,
    routes: { 'GET /api/me': me(user), ...routes },
  });
}

async function ready() {
  await screen.findByRole('heading', { level: 1, name: 'Profile' });
  await screen.findByLabelText(/Display name/);
}

function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('ProfilePage account', () => {
  it('shows the read-only account data and the quota note', async () => {
    renderProfile(makeUser({ email: 'ada@example.com' }));
    await ready();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(await screen.findByText(/no quota/i)).toBeInTheDocument();
  });

  it('saves the display name', async () => {
    const user = makeUser();
    const { api } = renderProfile(user, {
      'PATCH /api/me': (req: MockRequest) =>
        me({ ...user, displayName: (req.body as { displayName: string }).displayName }),
    });
    await ready();
    fill(/Display name/, '  Ada  ');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PATCH /api/me')).toHaveLength(1));
    expect(api.callsTo('PATCH /api/me')[0]?.body).toEqual({ displayName: 'Ada' });
  });

  it('sends null when the display name is emptied', async () => {
    const user = makeUser({ displayName: 'Ada' });
    const { api } = renderProfile(user, {
      'PATCH /api/me': me({ ...user, displayName: null }),
    });
    await ready();
    fill(/Display name/, '');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PATCH /api/me')).toHaveLength(1));
    expect(api.callsTo('PATCH /api/me')[0]?.body).toEqual({ displayName: null });
  });

  it('rejects a display name that is too long without calling the API', async () => {
    const { api } = renderProfile(makeUser());
    await ready();
    fill(/Display name/, 'x'.repeat(81));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findAllByText('The name is too long.')).length).toBeGreaterThan(0);
    expect(api.callsTo('PATCH /api/me')).toHaveLength(0);
  });
});

describe('ProfilePage preferences', () => {
  it('saves language and theme to the profile', async () => {
    const user = makeUser();
    const { api } = renderProfile(user, { 'PATCH /api/me': me(user) });
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'Italiano' }));
    await waitFor(() =>
      expect(
        api.callsTo('PATCH /api/me').some((c) => (c.body as { locale?: string }).locale === 'it'),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Scuro' }));
    await waitFor(() =>
      expect(
        api
          .callsTo('PATCH /api/me')
          .some((c) => (c.body as { themePreference?: string }).themePreference === 'dark'),
      ).toBe(true),
    );
  });
});

describe('ProfilePage password', () => {
  function submitPassword(current: string, next: string, confirm: string) {
    fill('Current password', current);
    fill('New password', next);
    fill('Confirm new password', confirm);
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  }

  it('validates the confirmation locally', async () => {
    const { api } = renderProfile(makeUser());
    await ready();
    submitPassword('old-password-1', 'a-new-long-password', 'different-password');
    expect((await screen.findAllByText('The two passwords do not match.')).length).toBeGreaterThan(
      0,
    );
    expect(api.callsTo('POST /api/me/password')).toHaveLength(0);
  });

  it('shows PASSWORD_INCORRECT inline on the current password', async () => {
    renderProfile(makeUser(), {
      'POST /api/me/password': apiError(403, 'PASSWORD_INCORRECT'),
    });
    await ready();
    submitPassword('wrong-password-1', 'a-new-long-password', 'a-new-long-password');
    expect(
      (await screen.findAllByText('The password you entered is incorrect.')).length,
    ).toBeGreaterThan(0);
  });

  it('shows the retry time when rate limited', async () => {
    renderProfile(makeUser(), {
      'POST /api/me/password': {
        status: 429,
        body: { error: { code: 'RATE_LIMITED', message: 'x', requestId: 'r' } },
        headers: { 'Retry-After': '300' },
      },
    });
    await ready();
    submitPassword('old-password-1', 'a-new-long-password', 'a-new-long-password');
    expect(await screen.findByText(/Try again in 5 min/)).toBeInTheDocument();
  });

  it('changes the password and explains that other sessions were signed out', async () => {
    const { api } = renderProfile(makeUser(), { 'POST /api/me/password': { status: 204 } });
    await ready();
    submitPassword('old-password-1', 'a-new-long-password', 'a-new-long-password');
    expect(await screen.findByText(/signed out of all your other devices/)).toBeInTheDocument();
    expect(api.callsTo('POST /api/me/password')[0]?.body).toEqual({
      currentPassword: 'old-password-1',
      newPassword: 'a-new-long-password',
    });
  });
});

describe('ProfilePage two-factor', () => {
  it('enables 2FA and requires confirming the recovery codes', async () => {
    const user = makeUser({ totpEnabled: false });
    const { api } = renderProfile(user, {
      'POST /api/me/2fa/setup': {
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/EasySend:user?secret=JBSWY3DPEHPK3PXP',
      },
      'POST /api/me/2fa/enable': { recoveryCodes: ['aaaa-bbbb-cccc', 'dddd-eeee-ffff'] },
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor authentication' }));
    await screen.findByText('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
    fireEvent.change(screen.getByLabelText('Code from the app'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and enable' }));
    await screen.findByText('aaaa-bbbb-cccc');
    expect(api.callsTo('POST /api/me/2fa/enable')[0]?.body).toEqual({ code: '123456' });
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(done).toBeEnabled();
    fireEvent.click(done);
    expect(
      await screen.findByRole('button', { name: 'Regenerate recovery codes' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('aaaa-bbbb-cccc')).not.toBeInTheDocument();
  });

  it('shows INVALID_TOTP_CODE when enabling with a wrong code', async () => {
    renderProfile(makeUser({ totpEnabled: false }), {
      'POST /api/me/2fa/setup': {
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/x',
      },
      'POST /api/me/2fa/enable': apiError(401, 'INVALID_TOTP_CODE'),
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Enable two-factor authentication' }));
    await screen.findByText('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
    fireEvent.change(screen.getByLabelText('Code from the app'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and enable' }));
    expect(await screen.findByText('The code is incorrect or has expired.')).toBeInTheDocument();
  });

  it('disabling requires the password and a code', async () => {
    const { api } = renderProfile(makeUser(), { 'POST /api/me/2fa/disable': { status: 204 } });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Disable two-factor authentication' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Disable' }));
    expect((await screen.findAllByText('Enter your current password.')).length).toBeGreaterThan(0);
    expect(api.callsTo('POST /api/me/2fa/disable')).toHaveLength(0);

    fill('Your password', 'my-password-123');
    fireEvent.change(screen.getByLabelText('Code from the app'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(api.callsTo('POST /api/me/2fa/disable')).toHaveLength(1));
    expect(api.callsTo('POST /api/me/2fa/disable')[0]?.body).toEqual({
      password: 'my-password-123',
      code: '654321',
    });
    expect(
      await screen.findByRole('button', { name: 'Enable two-factor authentication' }),
    ).toBeInTheDocument();
  });

  it('regenerates the recovery codes after re-authentication', async () => {
    renderProfile(makeUser(), {
      'POST /api/me/2fa/recovery-codes': { recoveryCodes: ['1111-2222-3333'] },
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate recovery codes' }));
    fill('Your password', 'my-password-123');
    fireEvent.change(screen.getByLabelText('Code from the app'), { target: { value: '654321' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Generate new codes' }));
    expect(await screen.findByText('1111-2222-3333')).toBeInTheDocument();
  });

  it('does not let an admin disable their own 2FA', async () => {
    renderProfile(makeAdmin());
    await ready();
    const button = screen.getByRole('button', { name: 'Disable two-factor authentication' });
    expect(button).toBeDisabled();
    expect(screen.getByText(/mandatory for administrators/)).toBeInTheDocument();
  });
});
