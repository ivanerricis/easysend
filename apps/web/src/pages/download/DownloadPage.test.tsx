import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiError, makePublicSettings, renderWithProviders } from '@/test/render';
import DownloadPage from './DownloadPage';

const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz0123456789';
const INFO_KEY = `GET /api/downloads/${TOKEN}`;

const future = Math.floor(Date.now() / 1000) + 3 * 86_400;

function unlockedInfo(overrides: Record<string, unknown> = {}) {
  return {
    locked: false,
    title: 'Holiday photos',
    message: 'Line one\nLine two',
    senderName: 'Ada Lovelace',
    files: [
      { id: 'f1', name: 'one.jpg', sizeBytes: 2048 },
      { id: 'f2', name: 'two.pdf', sizeBytes: 1_048_576 },
    ],
    totalBytes: 1_050_624,
    expiresAt: future,
    downloadCount: 1,
    maxDownloads: null,
    ...overrides,
  };
}

function renderPage(routes: Record<string, unknown>) {
  return renderWithProviders(
    <Routes>
      <Route path="/d/:token" element={<DownloadPage />} />
    </Routes>,
    {
      route: `/d/${TOKEN}`,
      publicSettings: makePublicSettings({
        appearance: { ...makePublicSettings().appearance, instanceName: 'Acme Share' },
      }),
      routes,
    },
  );
}

// jsdom cannot navigate: swallow the default action of link clicks.
const preventNavigation = (event: Event) => {
  if ((event.target as Element).closest('a')) event.preventDefault();
};
beforeEach(() => document.addEventListener('click', preventNavigation));
afterEach(() => document.removeEventListener('click', preventNavigation));

describe('DownloadPage', () => {
  it('unlocks a protected link with the password and then shows the files', async () => {
    let unlocked = false;
    const { api } = renderPage({
      [INFO_KEY]: () => (unlocked ? unlockedInfo() : { locked: true, expiresAt: future }),
      [`POST /api/downloads/${TOKEN}/unlock`]: () => {
        unlocked = true;
        return { status: 204 };
      },
    });
    await screen.findByRole('heading', { level: 1, name: /protected/i });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByRole('heading', { level: 1, name: 'Holiday photos' });
    expect(api.callsTo(`POST /api/downloads/${TOKEN}/unlock`)[0]?.body).toEqual({
      password: 'secret',
    });
  });

  it('shows an inline error for a wrong password', async () => {
    renderPage({
      [INFO_KEY]: { locked: true, expiresAt: future },
      [`POST /api/downloads/${TOKEN}/unlock`]: apiError(403, 'PASSWORD_INCORRECT'),
    });
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('The password you entered is incorrect.')).toBeInTheDocument();
  });

  it('shows the retry time when the unlock is rate limited', async () => {
    renderPage({
      [INFO_KEY]: { locked: true, expiresAt: future },
      [`POST /api/downloads/${TOKEN}/unlock`]: {
        status: 429,
        body: { error: { code: 'RATE_LIMITED', message: 'x', requestId: 'r' } },
        headers: { 'Retry-After': '120' },
      },
    });
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText(/Try again in 2 min/)).toBeInTheDocument();
  });

  it('falls back to the instance name when the sender has no display name', async () => {
    renderPage({ [INFO_KEY]: unlockedInfo({ senderName: null }) });
    expect(await screen.findByText('Sent by Acme Share')).toBeInTheDocument();
  });

  it('shows the sender name and keeps the message line breaks as plain text', async () => {
    renderPage({ [INFO_KEY]: unlockedInfo({ message: '<b>hi</b>\nthere' }) });
    expect(await screen.findByText('Sent by Ada Lovelace')).toBeInTheDocument();
    const message = screen.getByText(/<b>hi<\/b>/);
    expect(message.className).toContain('whitespace-pre-wrap');
    expect(message.querySelector('b')).toBeNull();
  });

  it('links each file and the zip, including the selection', async () => {
    renderPage({ [INFO_KEY]: unlockedInfo() });
    await screen.findByRole('heading', { level: 1, name: 'Holiday photos' });
    const one = screen.getByRole('link', { name: /Download one\.jpg/ });
    expect(one).toHaveAttribute('href', `/api/downloads/${TOKEN}/files/f1`);
    expect(one).toHaveAttribute('download');
    expect(screen.getByRole('link', { name: 'Download all as ZIP' })).toHaveAttribute(
      'href',
      `/api/downloads/${TOKEN}/zip`,
    );
    const selectedButton = screen.getByRole('button', { name: 'Download selected as ZIP' });
    expect(selectedButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select two.pdf' }));
    expect(screen.getByRole('link', { name: 'Download selected as ZIP' })).toHaveAttribute(
      'href',
      `/api/downloads/${TOKEN}/zip?fileIds=f2`,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all files' }));
    expect(screen.getByRole('link', { name: 'Download selected as ZIP' })).toHaveAttribute(
      'href',
      `/api/downloads/${TOKEN}/zip?fileIds=f1%2Cf2`,
    );
  });

  it('announces the start of a download and refetches the counter', async () => {
    const { api } = renderPage({ [INFO_KEY]: unlockedInfo() });
    await screen.findByRole('heading', { level: 1, name: 'Holiday photos' });
    fireEvent.click(screen.getByRole('link', { name: /Download one\.jpg/ }));
    expect(await screen.findByText(/Download started/)).toBeInTheDocument();
    await waitFor(() => expect(api.callsTo(INFO_KEY).length).toBeGreaterThan(1), {
      timeout: 4000,
    });
  });

  it('warns when the download limit is close', async () => {
    renderPage({ [INFO_KEY]: unlockedInfo({ maxDownloads: 3, downloadCount: 2 }) });
    expect(await screen.findByText(/Only 1 download left/)).toBeInTheDocument();
    expect(screen.getByText('2 of 3 used')).toBeInTheDocument();
  });

  it.each([
    ['TRANSFER_NOT_FOUND', 404, 'Link not valid'],
    ['TRANSFER_EXPIRED', 410, 'Transfer expired'],
    ['TRANSFER_REVOKED', 410, 'Transfer revoked'],
    ['DOWNLOAD_LIMIT_REACHED', 410, 'Download limit reached'],
    ['RATE_LIMITED', 429, 'Too many requests'],
    ['INTERNAL_ERROR', 500, 'Could not load the transfer'],
  ])('renders the %s state with its own h1', async (code, status, title) => {
    renderPage({ [INFO_KEY]: apiError(status, code) });
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  });
});
