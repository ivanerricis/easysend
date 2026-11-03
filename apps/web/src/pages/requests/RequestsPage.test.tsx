import type { UploadRequestDetail, UploadRequestSummary } from '@easysend/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTransferSummary } from '@/features/upload/fixtures';
import { chooseOption, getSelect } from '@/test/select';
import { makeUser, renderApp } from '@/test/render';

const SHARE = 'http://localhost:8080/r/tok123';

function makeRequest(overrides: Partial<UploadRequestSummary> = {}): UploadRequestSummary {
  return {
    id: 'r1',
    title: 'Contract documents',
    status: 'active',
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
    expiresAt: 4_100_000_000,
    expiresIn: '1w',
    hasPassword: false,
    maxTotalBytes: 5 * 1024 ** 3,
    maxSubmissions: 10,
    requireName: false,
    requireEmail: false,
    submissionCount: 3,
    receivedBytes: 1024 ** 2,
    shareUrl: SHARE,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<UploadRequestDetail> = {}): UploadRequestDetail {
  return { ...makeRequest(), message: 'Send the signed PDF', transfers: [], ...overrides };
}

function list(items = [makeRequest()]) {
  return { items, total: items.length, page: 1, pageSize: 20 };
}

async function openList(
  route = '/requests',
  routes: Record<string, unknown> = { 'GET /api/requests': list() },
) {
  const view = renderApp({ route, session: makeUser(), routes });
  await screen.findByRole('heading', { level: 1, name: 'Receive files' });
  return view;
}

const lastQuery = (calls: { query: URLSearchParams }[]) => calls[calls.length - 1]?.query;

afterEach(() => vi.restoreAllMocks());

describe('RequestsPage list', () => {
  it('lists requests with status, submissions, received bytes and expiry', async () => {
    await openList();
    const links = await screen.findAllByRole('link', { name: 'Contract documents' });
    expect(links[0]).toHaveAttribute('href', '/requests/r1');
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3 / 10').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1(\.0)? MB \/ 5(\.0)? GB|1 MiB \/ 5 GiB/).length).toBeGreaterThan(
      0,
    );
  });

  it('shows an empty state with a call to action', async () => {
    await openList('/requests', { 'GET /api/requests': list([]) });
    expect(await screen.findByText('No requests yet')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'New request' }).length).toBeGreaterThan(1);
  });

  it('reads the filters from the URL and updates them', async () => {
    const { api } = await openList('/requests?status=revoked&q=abc&page=2');
    await waitFor(() => expect(api.callsTo('GET /api/requests').length).toBeGreaterThan(0));
    const first = lastQuery(api.callsTo('GET /api/requests'));
    expect(first?.get('status')).toBe('revoked');
    expect(first?.get('q')).toBe('abc');
    expect(first?.get('page')).toBe('2');
    expect(getSelect('Status')).toHaveTextContent('Revoked');

    await chooseOption('Status', 'Expired');
    await waitFor(() =>
      expect(lastQuery(api.callsTo('GET /api/requests'))?.get('status')).toBe('expired'),
    );
    expect(lastQuery(api.callsTo('GET /api/requests'))?.get('page')).toBe('1');
  });

  it('copies the link of an active request from the row menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await openList();
    fireEvent.keyDown((await screen.findAllByRole('button', { name: /Actions for/ }))[0]!, {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHARE));
  });

  it('offers no copy or edit for a revoked request', async () => {
    await openList('/requests', {
      'GET /api/requests': list([makeRequest({ status: 'revoked' })]),
    });
    fireEvent.keyDown((await screen.findAllByRole('button', { name: /Actions for/ }))[0]!, {
      key: 'Enter',
    });
    await screen.findByRole('menuitem', { name: 'Delete' });
    expect(screen.queryByRole('menuitem', { name: 'Copy link' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Revoke' })).toBeNull();
  });

  it('revokes and deletes after confirmation', async () => {
    const { api } = await openList('/requests', {
      'GET /api/requests': list(),
      'POST /api/requests/r1/revoke': makeDetail({ status: 'revoked' }),
      'DELETE /api/requests/r1': { status: 204 },
    });
    const open = async () =>
      fireEvent.keyDown((await screen.findAllByRole('button', { name: /Actions for/ }))[0]!, {
        key: 'Enter',
      });

    await open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Revoke' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(api.callsTo('POST /api/requests/r1/revoke')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(api.callsTo('POST /api/requests/r1/revoke')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    await open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.callsTo('DELETE /api/requests/r1')).toHaveLength(1));
  });
});

describe('Request form', () => {
  it('creates a request with the size in bytes and shows the link in the page', async () => {
    const { api } = await openList('/requests', {
      'GET /api/requests': list(),
      'POST /api/requests': { status: 201, body: makeDetail({ id: 'r2' }) },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'New request' })[0]!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: ' Photos ' } });
    fireEvent.change(within(dialog).getByLabelText(/Instructions/), {
      target: { value: 'Raw files please' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Maximum total size/), {
      target: { value: '2' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Maximum number of submissions/), {
      target: { value: '5' },
    });
    fireEvent.click(within(dialog).getByRole('switch', { name: /sender's name/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(api.callsTo('POST /api/requests')).toHaveLength(1));
    expect(api.callsTo('POST /api/requests')[0]?.body).toEqual({
      title: 'Photos',
      expiresIn: '1w',
      message: 'Raw files please',
      maxTotalBytes: 2 * 1024 ** 3,
      maxSubmissions: 5,
      requireName: true,
      requireEmail: false,
    });
    // The link stays in the page, with a copy button.
    expect(await screen.findByText('Request created')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Upload link' })).toHaveValue(SHARE);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeVisible();
  });

  it('shows a validation error for an empty title', async () => {
    const { api } = await openList();
    fireEvent.click(screen.getAllByRole('button', { name: 'New request' })[0]!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect((await within(dialog).findAllByText(/A title is required/)).length).toBeGreaterThan(0);
    expect(api.callsTo('POST /api/requests')).toHaveLength(0);
  });

  it('edits a request and removes its password', async () => {
    const detail = makeDetail({ hasPassword: true });
    const { api } = await openList('/requests', {
      'GET /api/requests': list([makeRequest({ hasPassword: true })]),
      'GET /api/requests/r1': detail,
      'PATCH /api/requests/r1': makeDetail(),
    });
    fireEvent.keyDown((await screen.findAllByRole('button', { name: /Actions for/ }))[0]!, {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Maximum total size/)).toHaveValue('5');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Remove the password' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PATCH /api/requests/r1')).toHaveLength(1));
    expect(api.callsTo('PATCH /api/requests/r1')[0]?.body).toEqual({ removePassword: true });
  });

  it('removes the size limit when the field is emptied', async () => {
    const { api } = await openList('/requests', {
      'GET /api/requests': list(),
      'GET /api/requests/r1': makeDetail(),
      'PATCH /api/requests/r1': makeDetail(),
    });
    fireEvent.keyDown((await screen.findAllByRole('button', { name: /Actions for/ }))[0]!, {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Maximum total size/), {
      target: { value: '' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.callsTo('PATCH /api/requests/r1')).toHaveLength(1));
    expect(api.callsTo('PATCH /api/requests/r1')[0]?.body).toEqual({ maxTotalBytes: null });
  });
});

describe('RequestDetailPage', () => {
  it('shows the summary, link and received transfers', async () => {
    const received = makeTransferSummary({
      id: 't9',
      title: 'Signed PDF',
      source: 'received',
      senderName: 'Ada',
      uploadRequestId: 'r1',
    });
    renderApp({
      route: '/requests/r1',
      session: makeUser(),
      routes: { 'GET /api/requests/r1': makeDetail({ transfers: [received] }) },
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Contract documents' }),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Upload link' })).toHaveValue(SHARE);
    expect(screen.getByText('Send the signed PDF')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Signed PDF' })).toHaveAttribute(
      'href',
      '/transfers/t9',
    );
    expect(screen.getByText('Received from Ada')).toBeVisible();
  });

  it('deletes and goes back to the list', async () => {
    const { api, router } = renderApp({
      route: '/requests/r1',
      session: makeUser(),
      routes: {
        'GET /api/requests/r1': makeDetail(),
        'GET /api/requests': list(),
        'DELETE /api/requests/r1': { status: 204 },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.callsTo('DELETE /api/requests/r1')).toHaveLength(1));
    await waitFor(() => expect(router.state.location.pathname).toBe('/requests'));
  });
});
