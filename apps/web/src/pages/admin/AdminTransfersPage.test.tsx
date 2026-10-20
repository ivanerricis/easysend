import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeAdmin, renderWithProviders } from '@/test/render';
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
};

function renderPage() {
  return renderWithProviders(<AdminTransfersPage />, {
    session: makeAdmin(),
    route: '/admin/transfers',
    routes: {
      'GET /api/admin/transfers': { items: [item], total: 1, page: 1, pageSize: 20 },
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

    const owner = screen.getByLabelText('Owner');
    await waitFor(() => expect(owner.querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(owner, { target: { value: 'u-ada' } });
    await waitFor(() =>
      expect(
        api.callsTo('GET /api/admin/transfers').some((c) => c.query.get('ownerId') === 'u-ada'),
      ).toBe(true),
    );

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'revoked' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'email' } });
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
});
