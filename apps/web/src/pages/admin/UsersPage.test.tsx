import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, makeAdmin, renderWithProviders } from '@/test/render';
import UsersPage from './UsersPage';
import { makeAdminListAdmin, makeAdminListUser, userList } from './testData';

const GIB = 1024 ** 3;

const me = makeAdminListAdmin();
const ada = makeAdminListUser({
  id: 'u-ada',
  email: 'ada@example.com',
  displayName: 'Ada',
  usedBytes: 2 * GIB,
  quotaBytes: 10 * GIB,
  transferCount: 3,
});

function renderPage(routes: Record<string, unknown> = {}, route = '/admin/users') {
  return renderWithProviders(<UsersPage />, {
    session: makeAdmin(),
    route,
    routes: { 'GET /api/admin/users': userList([me, ada]), ...routes },
  });
}

describe('UsersPage', () => {
  it('lists users and sends the search and role filters to the API', async () => {
    const { api } = renderPage();
    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'ada' } });
    await waitFor(() =>
      expect(api.callsTo('GET /api/admin/users').some((c) => c.query.get('q') === 'ada')).toBe(
        true,
      ),
    );

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'admin' } });
    await waitFor(() =>
      expect(api.callsTo('GET /api/admin/users').some((c) => c.query.get('role') === 'admin')).toBe(
        true,
      ),
    );
  });

  it('creates a user without a password and explains the welcome email', async () => {
    const { api } = renderPage({
      'POST /api/admin/users': {
        status: 201,
        body: makeAdminListUser({ email: 'new@example.com' }),
      },
    });
    await screen.findByText('ada@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'New user' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/welcome email with a link, valid for 72 hours/)).toBeVisible();

    fireEvent.change(within(dialog).getByLabelText('Email'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(api.callsTo('POST /api/admin/users')).toHaveLength(1));
    const body = api.callsTo('POST /api/admin/users')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ email: 'new@example.com', role: 'user', quotaBytes: null });
    expect(body).not.toHaveProperty('password');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows EMAIL_ALREADY_EXISTS inline on the email field', async () => {
    renderPage({ 'POST /api/admin/users': apiError(409, 'EMAIL_ALREADY_EXISTS') });
    await screen.findByText('ada@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'New user' }));
    const dialog = await screen.findByRole('dialog');
    const email = within(dialog).getByLabelText('Email');
    fireEvent.change(email, { target: { value: 'ada@example.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    expect(
      within(dialog).getAllByText('A user with this email already exists.').length,
    ).toBeGreaterThan(0);
  });

  it('converts the quota to bytes (GiB and MiB) and rejects invalid values', async () => {
    const { api } = renderPage({
      'POST /api/admin/users': { status: 201, body: makeAdminListUser() },
    });
    await screen.findByText('ada@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'New user' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Email'), {
      target: { value: 'q@example.com' },
    });

    fireEvent.change(within(dialog).getByLabelText('Storage quota'), { target: { value: 'abc' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findAllByText(/Enter a number greater than zero/)).not.toHaveLength(
      0,
    );
    expect(api.callsTo('POST /api/admin/users')).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText('Storage quota'), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(api.callsTo('POST /api/admin/users')).toHaveLength(1));
    expect(api.callsTo('POST /api/admin/users')[0]?.body).toMatchObject({ quotaBytes: 5 * GIB });
  });

  it('requires a target to reassign transfers and sends the delete query', async () => {
    const { api } = renderPage({ 'DELETE /api/admin/users/u-ada': { status: 204 } });
    await screen.findByText('ada@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Delete ada@example.com' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('radio', { name: /Reassign them to another user/ }));
    const confirm = within(dialog).getByRole('button', { name: 'Delete user' });
    expect(confirm).toBeDisabled();

    const target = await within(dialog).findByLabelText('New owner');
    await waitFor(() => expect(within(target).getAllByRole('option').length).toBeGreaterThan(1));
    // The user being deleted is not offered as a target.
    expect(within(target).queryByRole('option', { name: 'ada@example.com' })).toBeNull();
    fireEvent.change(target, { target: { value: me.id } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(api.callsTo('DELETE /api/admin/users/u-ada')).toHaveLength(1));
    const query = api.callsTo('DELETE /api/admin/users/u-ada')[0]?.query;
    expect(query?.get('transfers')).toBe('reassign');
    expect(query?.get('reassignTo')).toBe(me.id);
  });

  it('deletes with the "delete transfers" option by default', async () => {
    const { api } = renderPage({ 'DELETE /api/admin/users/u-ada': { status: 204 } });
    await screen.findByText('ada@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Delete ada@example.com' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete user' }));
    await waitFor(() => expect(api.callsTo('DELETE /api/admin/users/u-ada')).toHaveLength(1));
    expect(api.callsTo('DELETE /api/admin/users/u-ada')[0]?.query.get('transfers')).toBe('delete');
  });

  it('shows the LAST_ADMIN error inside the delete dialog', async () => {
    renderPage({ 'DELETE /api/admin/users/u-ada': apiError(409, 'LAST_ADMIN') });
    await screen.findByText('ada@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Delete ada@example.com' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete user' }));
    expect(
      await within(dialog).findByText('At least one active administrator must remain.'),
    ).toBeInTheDocument();
  });

  it('offers no delete action for the signed-in admin', async () => {
    renderPage();
    await screen.findByText('ada@example.com');
    expect(screen.getByRole('button', { name: 'Delete ada@example.com' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete admin@example.com' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit admin@example.com' })).toBeInTheDocument();
  });

  it('resets 2FA after confirmation', async () => {
    const { api } = renderPage({ 'POST /api/admin/users/u-ada/reset-2fa': { status: 204 } });
    await screen.findByText('ada@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Reset 2FA of ada@example.com' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/sign in with the password only/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset 2FA' }));
    await waitFor(() =>
      expect(api.callsTo('POST /api/admin/users/u-ada/reset-2fa')).toHaveLength(1),
    );
  });

  it('sends only the changed fields when editing a user', async () => {
    const { api } = renderPage({
      'PATCH /api/admin/users/u-ada': makeAdminListUser({ id: 'u-ada', quotaBytes: null }),
    });
    await screen.findByText('ada@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Edit ada@example.com' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Storage quota'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PATCH /api/admin/users/u-ada')).toHaveLength(1));
    expect(api.callsTo('PATCH /api/admin/users/u-ada')[0]?.body).toEqual({ quotaBytes: null });
  });
});
