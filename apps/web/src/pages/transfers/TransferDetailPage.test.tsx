import type { TransferDetail } from '@easysend/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeTransferDetail } from '@/features/upload/fixtures';
import { chooseOption } from '@/test/select';
import { apiError, makeAdmin, makeUser, renderApp } from '@/test/render';

const emptyLog = { items: [], total: 0, page: 1, pageSize: 20 };

async function openDetail(
  transfer: TransferDetail | ReturnType<typeof apiError>,
  options: { admin?: boolean; routes?: Record<string, unknown> } = {},
) {
  const view = renderApp({
    route: '/transfers/t1',
    session: options.admin ? makeAdmin() : makeUser(),
    routes: {
      'GET /api/transfers/t1': transfer,
      'GET /api/transfers/t1/downloads': emptyLog,
      'GET /api/transfers': { items: [], total: 0, page: 1, pageSize: 20 },
      ...options.routes,
    },
  });
  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent(
      /^(Transfer details)?$/,
    ),
  );
  return view;
}

describe('TransferDetailPage', () => {
  it('shows the transfer, its link and its files', async () => {
    await openDetail(
      makeTransferDetail({
        message: 'See you soon',
        firstDownloadedAt: 1_700_100_000,
        hasPassword: true,
      }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Holiday photos' })).toBeVisible();
    expect(screen.getByDisplayValue('http://localhost:8080/d/abc123')).toHaveAttribute('readonly');
    expect(screen.getByText('photo.jpg')).toBeVisible();
    expect(screen.getByText('2 / 10')).toBeVisible();
    expect(screen.getByText('Protected')).toBeVisible();
    expect(screen.getByText('See you soon')).toBeVisible();
    expect(screen.getByText(/SHA-256 aaaaaaaaaaaa…/)).toBeVisible();
    expect(await screen.findByText('Nobody has downloaded this transfer yet.')).toBeVisible();
  });

  it('shows the owner only to an admin looking at somebody else’s transfer', async () => {
    await openDetail(makeTransferDetail({ ownerEmail: 'owner@example.com' }), { admin: true });
    expect(screen.getByText('owner@example.com')).toBeVisible();
  });

  it('does not show the owner to the owner', async () => {
    await openDetail(makeTransferDetail({ ownerEmail: 'owner@example.com' }));
    expect(screen.queryByText('owner@example.com')).not.toBeInTheDocument();
  });

  it('lists recipients with their notification status and resends the email', async () => {
    const { api } = await openDetail(
      makeTransferDetail({
        mode: 'email',
        recipients: [
          { email: 'a@example.com', notifiedAt: 1_700_000_100 },
          { email: 'b@example.com', notifiedAt: null },
        ],
      }),
      { routes: { 'POST /api/transfers/t1/resend': makeTransferDetail({ mode: 'email' }) } },
    );
    expect(screen.getByText('a@example.com')).toBeVisible();
    expect(screen.getByText('not notified yet')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Resend email' }));
    await waitFor(() => expect(api.callsTo('POST /api/transfers/t1/resend')).toHaveLength(1));
  });

  it('shows a not-found state', async () => {
    await openDetail(apiError(404, 'TRANSFER_NOT_FOUND'));
    expect(screen.getByRole('heading', { level: 1, name: 'Transfer not found' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'All transfers' })).toHaveAttribute(
      'href',
      '/transfers',
    );
  });

  it('revokes after confirmation', async () => {
    let revoked = false;
    const revokedTransfer = makeTransferDetail({ status: 'revoked', shareUrl: null });
    const { api } = await openDetail(makeTransferDetail(), {
      routes: {
        'GET /api/transfers/t1': () => (revoked ? revokedTransfer : makeTransferDetail()),
        'POST /api/transfers/t1/revoke': () => {
          revoked = true;
          return revokedTransfer;
        },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Revoke this link?')).toBeVisible();
    expect(api.callsTo('POST /api/transfers/t1/revoke')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(api.callsTo('POST /api/transfers/t1/revoke')).toHaveLength(1));
    expect(await screen.findByText('Revoked')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('deletes after confirmation and goes back to the list', async () => {
    const { api, router } = await openDetail(makeTransferDetail(), {
      routes: { 'DELETE /api/transfers/t1': { status: 204 } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.callsTo('DELETE /api/transfers/t1')).toHaveLength(1));
    await waitFor(() => expect(router.state.location.pathname).toBe('/transfers'));
  });

  it('lets a draft be resumed or cleaned up, and removes a file from it', async () => {
    const { api } = await openDetail(
      makeTransferDetail({
        status: 'uploading',
        shareUrl: null,
        uploads: [
          {
            id: 'u1',
            fileName: 'big.iso',
            totalSize: 99,
            status: 'processing',
            expiresAt: 4_100_000_000,
          },
        ],
      }),
      { routes: { 'DELETE /api/transfers/t1/files/f1': { status: 204 } } },
    );
    expect(screen.getByRole('link', { name: 'Resume upload' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(screen.getByText('big.iso')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Delete photo.jpg' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.callsTo('DELETE /api/transfers/t1/files/f1')).toHaveLength(1));
  });

  it('shows the download log', async () => {
    await openDetail(makeTransferDetail(), {
      routes: {
        'GET /api/transfers/t1/downloads': {
          items: [
            {
              id: 'd1',
              fileId: null,
              fileName: null,
              bytesSent: 2048,
              userAgent: 'Mozilla/5.0',
              createdAt: 1_700_000_500,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      },
    });
    expect((await screen.findAllByText('ZIP archive')).length).toBeGreaterThan(0);
  });
});

describe('EditTransferDialog', () => {
  async function openEdit(transfer: TransferDetail) {
    const view = await openDetail(transfer, {
      routes: { 'PATCH /api/transfers/t1': { ...transfer, title: 'Renamed' } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    return { ...view, dialog };
  }

  it('sends only the fields that changed', async () => {
    const { api, dialog } = await openEdit(makeTransferDetail());
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Renamed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PATCH /api/transfers/t1')).toHaveLength(1));
    expect(api.callsTo('PATCH /api/transfers/t1')[0]?.body).toEqual({ title: 'Renamed' });
  });

  it('explains when nothing changed', async () => {
    const { api, dialog } = await openEdit(makeTransferDetail());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Nothing has changed yet.')).toBeVisible();
    expect(api.callsTo('PATCH /api/transfers/t1')).toHaveLength(0);
  });

  it('turns an empty download limit into null (unlimited)', async () => {
    const { api, dialog } = await openEdit(makeTransferDetail({ maxDownloads: 10 }));
    fireEvent.change(within(dialog).getByLabelText(/^Download limit/), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PATCH /api/transfers/t1')).toHaveLength(1));
    expect(api.callsTo('PATCH /api/transfers/t1')[0]?.body).toEqual({ maxDownloads: null });
  });

  it('sets a new password and checks its length', async () => {
    const { api, dialog } = await openEdit(makeTransferDetail());
    expect(within(dialog).queryByLabelText('New password')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Set a password' }));
    const input = within(dialog).getByLabelText('New password');
    fireEvent.change(input, { target: { value: 'short' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect((await within(dialog).findAllByText(/at least 8 characters/)).length).toBeGreaterThan(0);
    expect(api.callsTo('PATCH /api/transfers/t1')).toHaveLength(0);

    fireEvent.change(input, { target: { value: 'long enough password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PATCH /api/transfers/t1')).toHaveLength(1));
    expect(api.callsTo('PATCH /api/transfers/t1')[0]?.body).toEqual({
      password: 'long enough password',
    });
  });

  it('removes the password and never sends both options', async () => {
    const { api, dialog } = await openEdit(makeTransferDetail({ hasPassword: true }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Replace the password' }));
    fireEvent.change(within(dialog).getByLabelText('New password'), {
      target: { value: 'long enough password' },
    });
    // Switching to "remove" hides the password field and drops the typed password.
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Remove the password' }));
    expect(within(dialog).queryByLabelText('New password')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PATCH /api/transfers/t1')).toHaveLength(1));
    expect(api.callsTo('PATCH /api/transfers/t1')[0]?.body).toEqual({ removePassword: true });
  });

  it('restarts the expiry from now', async () => {
    const { api, dialog } = await openEdit(makeTransferDetail());
    await chooseOption('Expiry', 'Expire 1 month from now', within(dialog));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PATCH /api/transfers/t1')).toHaveLength(1));
    expect(api.callsTo('PATCH /api/transfers/t1')[0]?.body).toEqual({ expiresIn: '1m' });
  });
});
