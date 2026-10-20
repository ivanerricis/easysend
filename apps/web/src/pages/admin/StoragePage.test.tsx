import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeAdmin, renderWithProviders } from '@/test/render';
import StoragePage from './StoragePage';
import { makeStorage } from './testData';

describe('StoragePage', () => {
  it('shows the disk figures, the legend and an accessible bar description', async () => {
    const { api } = renderWithProviders(<StoragePage />, {
      session: makeAdmin(),
      route: '/admin/storage',
      routes: { 'GET /api/admin/storage': makeStorage() },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Storage' })).toBeInTheDocument();

    const bar = await screen.findByRole('img', { name: /Disk usage, total 100 GiB/ });
    // Other data 30 GiB, files 10 GiB, reserve 5 GiB, available 55 GiB.
    expect(bar.getAttribute('aria-label')).toContain('Other data: 30 GiB');
    expect(bar.getAttribute('aria-label')).toContain('EasySend files: 10 GiB');
    expect(bar.getAttribute('aria-label')).toContain('Reserve: 5 GiB');
    expect(bar.getAttribute('aria-label')).toContain('Available: 55 GiB');

    // The legend repeats the values as text (colour is never the only cue).
    const legend = bar.parentElement?.querySelector('dl');
    expect(legend).not.toBeNull();
    expect(within(legend as HTMLElement).getByText('Reserve')).toBeInTheDocument();
    expect(within(legend as HTMLElement).getByText('55 GiB')).toBeInTheDocument();

    expect(screen.getByText('Active transfers').nextSibling).toHaveTextContent('7');
    expect(screen.getByText('Files').nextSibling).toHaveTextContent('42');

    expect(api.callsTo('GET /api/admin/storage')).toHaveLength(1);
  });

  it('sorts users by used bytes and refreshes on demand', async () => {
    const { api } = renderWithProviders(<StoragePage />, {
      session: makeAdmin(),
      route: '/admin/storage',
      routes: { 'GET /api/admin/storage': makeStorage() },
    });
    const first = await screen.findByText('big@example.com');
    const second = screen.getByText('small@example.com');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.callsTo('GET /api/admin/storage')).toHaveLength(2));
  });
});
