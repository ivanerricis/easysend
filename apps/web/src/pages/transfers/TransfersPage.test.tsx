import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTransferDetail, makeTransferSummary } from '@/features/upload/fixtures';
import { chooseOption, getSelect } from '@/test/select';
import { makeUser, renderApp } from '@/test/render';

const toasts = vi.hoisted(() => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));
vi.mock('@/lib/toast', () => toasts);

function list(items = [makeTransferSummary()], total = items.length) {
  return { items, total, page: 1, pageSize: 20 };
}

async function openList(
  route = '/transfers',
  response: unknown = list(),
  extraRoutes: Record<string, unknown> = {},
) {
  const view = renderApp({
    route,
    session: makeUser(),
    routes: { 'GET /api/transfers': response, ...extraRoutes },
  });
  await screen.findByRole('heading', { level: 1, name: 'Transfers' });
  return view;
}

const lastQuery = (calls: { query: URLSearchParams }[]) => calls[calls.length - 1]?.query;

function mockClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('TransfersPage', () => {
  describe('share link cell', () => {
    it('copies the link and shows a toast when the mode cell is clicked', async () => {
      const writeText = mockClipboard();
      await openList();
      const [button] = await screen.findAllByRole('button', {
        name: 'Copy the link of Holiday photos',
      });
      expect(button).toHaveTextContent('Link');
      fireEvent.click(button!);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://localhost:8080/d/abc123'));
      await waitFor(() => expect(toasts.notifySuccess).toHaveBeenCalledWith('Link copied'));
    });

    it('shows an error toast when the clipboard write fails', async () => {
      mockClipboard(vi.fn().mockRejectedValue(new Error('denied')));
      document.execCommand = vi.fn().mockReturnValue(false);
      await openList();
      const [button] = await screen.findAllByRole('button', {
        name: 'Copy the link of Holiday photos',
      });
      fireEvent.click(button!);
      await waitFor(() => expect(toasts.notifyError).toHaveBeenCalled());
      expect(toasts.notifySuccess).not.toHaveBeenCalled();
    });

    it('is plain text without a share link', async () => {
      await openList('/transfers', list([makeTransferSummary({ shareUrl: null })]));
      await screen.findAllByRole('link', { name: 'Holiday photos' });
      expect(screen.queryByRole('button', { name: /Copy the link of/ })).toBeNull();
    });

    it('is plain text when the transfer is no longer active', async () => {
      await openList('/transfers', list([makeTransferSummary({ status: 'revoked' })]));
      await screen.findAllByRole('link', { name: 'Holiday photos' });
      expect(screen.queryByRole('button', { name: /Copy the link of/ })).toBeNull();
    });
  });

  it('lists the transfers with status, size and downloads', async () => {
    await openList();
    expect((await screen.findAllByRole('link', { name: 'Holiday photos' })).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 / 10').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Holiday photos' })[0]).toHaveAttribute(
      'href',
      '/transfers/t1',
    );
  });

  it('falls back to a placeholder title', async () => {
    await openList('/transfers', list([makeTransferSummary({ title: null })]));
    expect((await screen.findAllByText('Untitled transfer')).length).toBeGreaterThan(0);
  });

  it('reads the filters from the URL', async () => {
    const { api } = await openList('/transfers?status=revoked&mode=email&q=hello&page=2');
    await waitFor(() => expect(api.callsTo('GET /api/transfers').length).toBeGreaterThan(0));
    const query = lastQuery(api.callsTo('GET /api/transfers'));
    expect(query?.get('status')).toBe('revoked');
    expect(query?.get('mode')).toBe('email');
    expect(query?.get('q')).toBe('hello');
    expect(query?.get('page')).toBe('2');
    expect(getSelect('Status')).toHaveTextContent('Revoked');
  });

  it('updates the query and the URL when a filter changes', async () => {
    const { api, router } = await openList('/transfers?page=3');
    await chooseOption('Status', 'Active');
    await waitFor(() =>
      expect(lastQuery(api.callsTo('GET /api/transfers'))?.get('status')).toBe('active'),
    );
    // Changing a filter goes back to the first page.
    expect(lastQuery(api.callsTo('GET /api/transfers'))?.get('page')).toBe('1');
    expect(router.state.location.search).toContain('status=active');
    expect(router.state.location.search).not.toContain('page=');

    await chooseOption('Mode', 'Email');
    await waitFor(() =>
      expect(lastQuery(api.callsTo('GET /api/transfers'))?.get('mode')).toBe('email'),
    );
  });

  it('debounces the search', async () => {
    const { api, router } = await openList();
    const before = api.callsTo('GET /api/transfers').length;
    const box = screen.getByLabelText('Search transfers');
    fireEvent.change(box, { target: { value: 'h' } });
    fireEvent.change(box, { target: { value: 'holiday' } });
    expect(api.callsTo('GET /api/transfers')).toHaveLength(before);
    await waitFor(() =>
      expect(lastQuery(api.callsTo('GET /api/transfers'))?.get('q')).toBe('holiday'),
    );
    expect(api.callsTo('GET /api/transfers').length).toBe(before + 1);
    expect(router.state.location.search).toContain('q=holiday');
  });

  it('shows an empty state with a call to action', async () => {
    await openList('/transfers', list([], 0));
    expect(await screen.findByText('No transfers yet')).toBeVisible();
    const links = screen.getAllByRole('link', { name: 'New transfer' });
    expect(links.every((link) => link.getAttribute('href') === '/')).toBe(true);
  });

  it('tells the difference between no transfers and no results', async () => {
    await openList('/transfers?status=expired', list([], 0));
    expect(await screen.findByText('No transfers found')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(getSelect('Status')).toHaveTextContent('All statuses'));
  });

  it('paginates', async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeTransferSummary({ id: `t${i}`, title: `Transfer ${i}` }),
    );
    const { api, router } = await openList('/transfers', list(items, 45));
    expect(await screen.findByText('Page 1 of 3')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(lastQuery(api.callsTo('GET /api/transfers'))?.get('page')).toBe('2'),
    );
    expect(router.state.location.search).toContain('page=2');
  });

  describe('row actions', () => {
    // The table and the mobile list are both in the DOM: use the first menu.
    async function openMenu(title = 'Holiday photos') {
      const trigger = (await screen.findAllByRole('button', { name: `Actions for ${title}` }))[0]!;
      fireEvent.keyDown(trigger, { key: 'Enter' });
      return screen.findByRole('menu');
    }

    const names = (menu: HTMLElement) =>
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent);

    it('offers only the actions that fit an active link transfer', async () => {
      await openList();
      const menu = await openMenu();
      expect(names(menu)).toEqual(['Open details', 'Copy link', 'Edit', 'Revoke', 'Delete']);
      expect(within(menu).getByRole('menuitem', { name: 'Open details' })).toHaveAttribute(
        'href',
        '/transfers/t1',
      );
      expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
        'data-variant',
        'destructive',
      );
    });

    it('offers only open and delete for a revoked transfer', async () => {
      await openList('/transfers', list([makeTransferSummary({ status: 'revoked' })]));
      expect(names(await openMenu())).toEqual(['Open details', 'Delete']);
    });

    it('leaves out copy link when the transfer has no share link', async () => {
      await openList('/transfers', list([makeTransferSummary({ shareUrl: null })]));
      expect(names(await openMenu())).toEqual(['Open details', 'Edit', 'Revoke', 'Delete']);
    });

    it('copies the share link from the menu', async () => {
      const writeText = mockClipboard();
      await openList();
      fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Copy link' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://localhost:8080/d/abc123'));
      await waitFor(() => expect(toasts.notifySuccess).toHaveBeenCalledWith('Link copied'));
    });

    it('revokes after confirmation', async () => {
      const { api } = await openList('/transfers', list(), {
        'POST /api/transfers/t1/revoke': makeTransferDetail({ status: 'revoked' }),
      });
      fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Revoke' }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
      await waitFor(() => expect(api.callsTo('POST /api/transfers/t1/revoke')).toHaveLength(1));
    });

    it('resends the email of an active email transfer', async () => {
      const { api } = await openList('/transfers', list([makeTransferSummary({ mode: 'email' })]), {
        'POST /api/transfers/t1/resend': makeTransferDetail({ mode: 'email' }),
      });
      fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Resend email' }));
      await waitFor(() => expect(api.callsTo('POST /api/transfers/t1/resend')).toHaveLength(1));
    });

    it('deletes after confirmation', async () => {
      const { api } = await openList('/transfers', list(), {
        'DELETE /api/transfers/t1': { status: 204 },
      });
      fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Delete' }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(api.callsTo('DELETE /api/transfers/t1')).toHaveLength(1));
    });

    it('returns the focus to the row menu after its dialog is cancelled', async () => {
      await openList();
      fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Delete' }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      const trigger = screen.getAllByRole('button', { name: 'Actions for Holiday photos' })[0]!;
      await waitFor(() => expect(trigger).toHaveFocus());
    });

    it('moves the focus to the main region when the deleted row is gone', async () => {
      let deleted = false;
      await openList('/transfers', () => (deleted ? list([], 0) : list()), {
        'DELETE /api/transfers/t1': () => {
          deleted = true;
          return { status: 204 };
        },
      });
      fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Delete' }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(document.getElementById('main')).toHaveFocus());
    });

    it('opens the edit dialog with the transfer details', async () => {
      await openList('/transfers', list(), { 'GET /api/transfers/t1': makeTransferDetail() });
      fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Edit' }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
  });
});
