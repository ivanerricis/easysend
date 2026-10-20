import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, makeUser, renderApp, TEST_CSRF } from '@/test/render';
import { safeReturnTo } from './helpers';

const user = makeUser({ email: 'ada@example.com' });
const OK = { status: 'ok', user, csrfToken: TEST_CSRF };
const COMPLETED = { user, csrfToken: TEST_CSRF };
const SETUP = {
  secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/EasySend:ada@example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
};

function signIn() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

function typeCode(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('safeReturnTo', () => {
  it('accepts only same-origin relative paths', () => {
    expect(safeReturnTo('/transfers?x=1')).toBe('/transfers?x=1');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo('/\\evil.example')).toBe('/');
    expect(safeReturnTo(null)).toBe('/');
  });
});

describe('LoginPage', () => {
  it('signs in and goes to the returnTo path', async () => {
    const { router, api } = renderApp({
      route: '/login?returnTo=%2Ftransfers',
      routes: { 'POST /api/auth/login': OK },
    });
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    signIn();
    await waitFor(() => expect(router.state.location.pathname).toBe('/transfers'));
    expect(api.callsTo('POST /api/auth/login')[0]?.body).toEqual({
      email: 'ada@example.com',
      password: 'a-long-password-1',
    });
  });

  it('ignores an unsafe returnTo', async () => {
    const { router } = renderApp({
      route: '/login?returnTo=%2F%2Fevil.example',
      routes: { 'POST /api/auth/login': OK },
    });
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    signIn();
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('redirects to the home page when already signed in', async () => {
    const { router } = renderApp({ route: '/login', session: user });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('validates the fields before calling the API', async () => {
    const { api } = renderApp({ route: '/login' });
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Please check the fields below')).toBeInTheDocument();
    expect(api.callsTo('POST /api/auth/login')).toHaveLength(0);
  });

  it('asks for the authenticator code and signs in when it is complete', async () => {
    const { router, api } = renderApp({
      route: '/login',
      routes: {
        'POST /api/auth/login': { status: 'mfa_required' },
        'POST /api/auth/login/2fa': COMPLETED,
      },
    });
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    signIn();
    await screen.findByRole('heading', { level: 1, name: 'Two-factor verification' });
    typeCode('Authentication code', '123456');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(api.callsTo('POST /api/auth/login/2fa')[0]?.body).toEqual({ code: '123456' });
  });

  it('shows an error for a wrong authenticator code', async () => {
    renderApp({
      route: '/login',
      routes: {
        'POST /api/auth/login': { status: 'mfa_required' },
        'POST /api/auth/login/2fa': apiError(401, 'INVALID_TOTP_CODE'),
      },
    });
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    signIn();
    await screen.findByRole('heading', { level: 1, name: 'Two-factor verification' });
    typeCode('Authentication code', '000000');
    expect(await screen.findByText('The code is incorrect or has expired.')).toBeInTheDocument();
  });

  it('warns about the recovery codes left after using one', async () => {
    const { router, api } = renderApp({
      route: '/login',
      routes: {
        'POST /api/auth/login': { status: 'mfa_required' },
        'POST /api/auth/login/recovery': { ...COMPLETED, recoveryCodesLeft: 2 },
      },
    });
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    signIn();
    await screen.findByRole('heading', { level: 1, name: 'Two-factor verification' });
    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    await screen.findByRole('heading', { level: 1, name: 'Sign in with a recovery code' });
    fireEvent.change(screen.getByLabelText(/Recovery code/), {
      target: { value: 'abcd-efgh-ijkl' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('You have 2 recovery codes left')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(api.callsTo('POST /api/auth/login/recovery')[0]?.body).toEqual({
      recoveryCode: 'abcd-efgh-ijkl',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to EasySend' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('cancels the second step with a logout and goes back to the password', async () => {
    const { api } = renderApp({
      route: '/login',
      routes: {
        'POST /api/auth/login': { status: 'mfa_required' },
        'POST /api/auth/logout': { status: 204 },
      },
    });
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    signIn();
    await screen.findByRole('heading', { level: 1, name: 'Two-factor verification' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and go back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    await waitFor(() => expect(api.callsTo('POST /api/auth/logout')).toHaveLength(1));
  });

  it('forces the two-factor enrolment when the API asks for it', async () => {
    const { router } = renderApp({
      route: '/login',
      routes: {
        'POST /api/auth/login': { status: 'mfa_setup_required' },
        'POST /api/auth/login/2fa-setup': SETUP,
        'POST /api/auth/login/2fa-setup/verify': {
          user,
          csrfToken: TEST_CSRF,
          recoveryCodes: ['aaaa-bbbb-cccc', 'dddd-eeee-ffff'],
        },
      },
    });
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    signIn();
    await screen.findByRole('heading', { level: 1, name: 'Set up two-factor authentication' });
    expect(screen.getByRole('img', { name: /QR code/ })).toBeInTheDocument();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    typeCode('3. Enter the 6-digit code shown by the app', '123456');
    await screen.findByText('aaaa-bbbb-cccc');
    const next = screen.getByRole('button', { name: 'Continue to EasySend' });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(next).toBeEnabled();
    fireEvent.click(next);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('says how long a locked account must wait', async () => {
    renderApp({
      route: '/login',
      routes: {
        'POST /api/auth/login': {
          ...apiError(429, 'ACCOUNT_LOCKED'),
          headers: { 'Retry-After': '900' },
        },
      },
    });
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    signIn();
    const alert = await screen.findByText(/Sign-in is locked for now/);
    expect(alert).toHaveTextContent('Try again in about 15 minutes.');
  });

  it('shows the generic message for wrong credentials', async () => {
    renderApp({
      route: '/login',
      routes: { 'POST /api/auth/login': apiError(401, 'INVALID_CREDENTIALS') },
    });
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    signIn();
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
  });

  it('links to the password reset page', async () => {
    renderApp({ route: '/login' });
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});

describe('ForgotPasswordPage', () => {
  it('always shows the same neutral confirmation', async () => {
    const { api } = renderApp({
      route: '/forgot-password',
      routes: { 'POST /api/auth/password-reset/request': { status: 202, body: { ok: true } } },
    });
    await screen.findByRole('heading', { level: 1, name: 'Forgot password' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nobody@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Check your email' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/If an account exists for nobody@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/30 minutes/)).toBeInTheDocument();
    expect(screen.getByText(/spam/)).toBeInTheDocument();
    expect(api.callsTo('POST /api/auth/password-reset/request')).toHaveLength(1);
  });

  it('reports rate limiting with the waiting time', async () => {
    renderApp({
      route: '/forgot-password',
      routes: {
        'POST /api/auth/password-reset/request': {
          ...apiError(429, 'RATE_LIMITED'),
          headers: { 'Retry-After': '3600' },
        },
      },
    });
    await screen.findByRole('heading', { level: 1, name: 'Forgot password' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/Try again in about 60 minutes/)).toBeInTheDocument();
  });
});

describe.each([
  ['reset', '/reset-password', 'Choose a new password', 'Password updated'],
  ['welcome', '/welcome', 'Welcome', 'Account activated'],
] as const)('%s page', (_name, path, title, doneTitle) => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'a-brand-new-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'a-brand-new-password' },
    });
  };

  it('explains a missing token and links to a way out', async () => {
    renderApp({ route: path });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Link not valid' }),
    ).toBeInTheDocument();
  });

  it('shows an invalid-token message after the API refuses the token', async () => {
    renderApp({
      route: `${path}?token=0123456789abcdef0123456789`,
      routes: { 'POST /api/auth/password-reset/confirm': apiError(400, 'RESET_TOKEN_INVALID') },
    });
    await screen.findByRole('heading', { level: 1, name: title });
    fill();
    fireEvent.click(screen.getByRole('button', { name: /Save new password|Activate account/ }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Link not valid' }),
    ).toBeInTheDocument();
  });

  it('rejects mismatching passwords without calling the API', async () => {
    const { api } = renderApp({ route: `${path}?token=0123456789abcdef0123456789` });
    await screen.findByRole('heading', { level: 1, name: title });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'a-brand-new-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'something-else-entirely' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save new password|Activate account/ }));
    expect((await screen.findAllByText('The two passwords do not match.')).length).toBeGreaterThan(
      0,
    );
    expect(api.callsTo('POST /api/auth/password-reset/confirm')).toHaveLength(0);
  });

  it('sets the password and links to the sign-in page', async () => {
    const { api } = renderApp({
      route: `${path}?token=0123456789abcdef0123456789`,
      routes: { 'POST /api/auth/password-reset/confirm': { ok: true } },
    });
    await screen.findByRole('heading', { level: 1, name: title });
    fill();
    fireEvent.click(screen.getByRole('button', { name: /Save new password|Activate account/ }));
    await screen.findByRole('heading', { level: 1, name: doneTitle });
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
    expect(api.callsTo('POST /api/auth/password-reset/confirm')[0]?.body).toEqual({
      token: '0123456789abcdef0123456789',
      newPassword: 'a-brand-new-password',
    });
  });
});
