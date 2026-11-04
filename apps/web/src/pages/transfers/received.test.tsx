import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeTransferDetail, makeTransferSummary } from '@/features/upload/fixtures';
import { chooseOption, getSelect } from '@/test/select';
import { makeUser, renderApp } from '@/test/render';

const page = (items = [makeTransferSummary()]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 20,
});

describe('received transfers in the list', () => {
  it('sends the source filter to the API and keeps it in the URL', async () => {
    const { api, router } = renderApp({
      route: '/transfers',
      session: makeUser(),
      routes: { 'GET /api/transfers': page() },
    });
    await screen.findByRole('heading', { level: 1, name: 'Transfers' });
    await chooseOption('Origin', 'Received');
    await waitFor(() => {
      const calls = api.callsTo('GET /api/transfers');
      expect(calls[calls.length - 1]?.query.get('source')).toBe('received');
    });
    expect(router.state.location.search).toContain('source=received');
  });

  it('reads the source filter from the URL', async () => {
    const { api } = renderApp({
      route: '/transfers?source=sent',
      session: makeUser(),
      routes: { 'GET /api/transfers': page() },
    });
    await screen.findByRole('heading', { level: 1, name: 'Transfers' });
    expect(getSelect('Origin')).toHaveTextContent('Sent');
    await waitFor(() => expect(api.callsTo('GET /api/transfers').length).toBeGreaterThan(0));
    expect(api.callsTo('GET /api/transfers')[0]?.query.get('source')).toBe('sent');
  });

  it('shows who a received transfer comes from', async () => {
    renderApp({
      route: '/transfers',
      session: makeUser(),
      routes: {
        'GET /api/transfers': page([
          makeTransferSummary({ id: 'a', source: 'received', senderName: 'Ada' }),
          makeTransferSummary({ id: 'b', source: 'received', senderEmail: 'bob@example.com' }),
          makeTransferSummary({ id: 'c', source: 'received' }),
          makeTransferSummary({ id: 'd', title: 'Mine' }),
        ]),
      },
    });
    expect((await screen.findAllByText('Received from Ada')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Received from bob@example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Received from anonymous').length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Received from/)).toHaveLength(
      screen.getAllByText('Received from Ada').length * 3,
    );
  });
});

describe('received transfer detail', () => {
  it('shows the sender and message, and hides recipients and resend', async () => {
    renderApp({
      route: '/transfers/t1',
      session: makeUser(),
      routes: {
        'GET /api/transfers/t1': makeTransferDetail({
          mode: 'email',
          source: 'received',
          senderName: 'Ada',
          senderEmail: 'ada@example.org',
          uploadRequestId: 'r1',
          message: 'Here are the files',
        }),
        'GET /api/transfers/t1/downloads': { items: [], total: 0, page: 1, pageSize: 20 },
      },
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'Sender' })).toBeVisible();
    expect(screen.getByText('Ada')).toBeVisible();
    expect(screen.getByText('ada@example.org')).toBeVisible();
    expect(screen.getByText('Here are the files')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open the request' })).toHaveAttribute(
      'href',
      '/requests/r1',
    );
    expect(screen.queryByRole('button', { name: 'Resend email' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Recipients' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
  });
});
