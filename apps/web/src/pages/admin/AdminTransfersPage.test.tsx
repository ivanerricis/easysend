import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeAdmin, renderWithProviders } from '@/test/render';
import { chooseOption } from '@/test/select';
import AdminTransfersPage from './AdminTransfersPage';
import { makeAdminListAdmin, makeAdminListUser, userList } from './testData';

const item = {
  id: 't1',
  title: 'Holiday photos',
  mode: 'link',
  status: 'active',
  ownerId: 'u-ada',
  ownerEmail: 'ada@example.com',
  createdAt: 1_700_000_000,
  expiresAt: 1_800_000_000,
  totalBytes: 5 * 1024 ** 2,
  fileCount: 2,
  recipientCount: 0,
  downloadCount: 1,
  maxDownloads: 5,
  hasPassword: true,
  source: 'sent',
  uploadRequestId: null,
  senderName: null,
  senderEmail: null,
  shareUrl: null,
};

const toasts = vi.hoisted(() => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));
vi.mock('@/lib/toast', () => toasts);

afterEach(() => {
  vi.clearAllMocks();
});

function renderPage(shareUrl: string | null = null) {
  return renderWithProviders(<AdminTransfersPage />, {
    session: makeAdmin(),
    route: '/admin/transfers',
    routes: {
      'GET /api/admin/transfers': {
        items: [{ ...item, shareUrl }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
      'GET /api/admin/users': userList([
        makeAdminListAdmin(),
        makeAdminListUser({ id: 'u-ada', email: 'ada@example.com' }),
      ]),
    },
  });
}

describe('AdminTransfersPage', () => {
  it('lists transfers with owner, links to the detail page and counts', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Holiday photos' });
    expect(link).toHaveAttribute('href', '/transfers/t1');
    expect(screen.getAllByText('ada@example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('1 / 5')).toBeInTheDocument();
  });

  it('filters by owner, status and type through the API query', async () => {
    const { api } = renderPage();
    await screen.findByRole('link', { name: 'Holiday photos' });

    await waitFor(() => expect(api.callsTo('GET /api/admin/users').length).toBeGreaterThan(0));
    await chooseOption('Owner', 'ada@example.com');
    await waitFor(() =>
      expect(
        api.callsTo('GET /api/admin/transfers').some((c) => c.query.get('ownerId') === 'u-ada'),
      ).toBe(true),
    );

    await chooseOption('Status', 'Revoked');
    await chooseOption('Type', 'Email');
    await waitFor(() =>
      expect(
        api
          .callsTo('GET /api/admin/transfers')
          .some(
            (c) =>
              c.query.get('status') === 'revoked' &&
              c.query.get('mode') === 'email' &&
              c.query.get('ownerId') === 'u-ada',
          ),
      ).toBe(true),
    );
  });

  it('copies the share link from the mode cell and the menu, only when there is one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPage('http://localhost:8080/d/abc123');
    fireEvent.click(
      await screen.findByRole('button', { name: /^[^:]+: copy the link of Holiday photos$/ }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://localhost:8080/d/abc123'));
    await waitFor(() => expect(toasts.notifySuccess).toHaveBeenCalledWith('Link copied'));
    const trigger = screen.getByRole('button', { name: 'Actions for Holiday photos' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(
      within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Copy link' }),
    ).toBeInTheDocument();
  });

  it('has no copy button without a share link', async () => {
    renderPage(null);
    await screen.findByRole('link', { name: 'Holiday photos' });
    expect(screen.queryByRole('button', { name: /copy the link of/ })).toBeNull();
  });

  it('opens a row actions menu with the admin actions, delete last', async () => {
    renderPage();
    const trigger = await screen.findByRole('button', { name: 'Actions for Holiday photos' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((entry) => entry.textContent),
    ).toEqual(['Open details', 'Edit', 'Revoke', 'Delete']);
  });

  it('returns the focus to the row menu after its dialog closes', async () => {
    renderPage();
    const trigger = await screen.findByRole('button', { name: 'Actions for Holiday photos' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Revoke' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
