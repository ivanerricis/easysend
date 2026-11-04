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

  it('shows the driver card and, with S3, the note about the temporary disk', async () => {
    const gib = 1024 ** 3;
    const first = renderWithProviders(<StoragePage />, {
      session: makeAdmin(),
      route: '/admin/storage',
      routes: { 'GET /api/admin/storage': makeStorage() },
    });
    const card = await screen.findByRole('region', { name: 'Storage in use' });
    expect(within(card).getByText('42 files, 10 GiB')).toBeInTheDocument();
    expect(within(card).queryByText(/temporary upload folder/)).not.toBeInTheDocument();
    first.unmount();

    renderWithProviders(<StoragePage />, {
      session: makeAdmin(),
      route: '/admin/storage',
      routes: {
        'GET /api/admin/storage': makeStorage({
          driver: 's3',
          usageByDriver: {
            local: { files: 0, bytes: 0 },
            s3: { files: 5, bytes: 2 * gib },
          },
        }),
      },
    });
    const s3Card = await screen.findByRole('region', { name: 'Storage in use' });
    expect(within(s3Card).getByText('5 files, 2 GiB')).toBeInTheDocument();
    expect(within(s3Card).getByText(/temporary upload folder/)).toBeInTheDocument();
    expect(within(s3Card).getByRole('link', { name: 'Change storage' })).toHaveAttribute(
      'href',
      '/admin/settings/storage',
    );
  });

  it('shows the Docker volume by default and the host folder when DATA_PATH is set', async () => {
    const first = renderWithProviders(<StoragePage />, {
      session: makeAdmin(),
      route: '/admin/storage',
      routes: { 'GET /api/admin/storage': makeStorage() },
    });
    const card = await screen.findByRole('region', { name: 'Where data is stored' });
    expect(within(card).getByText('Docker volume easysend-data')).toBeInTheDocument();
    expect(within(card).getByText('60 GiB')).toBeInTheDocument();
    expect(within(card).getByText('5 GiB')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /How to change it/ })).toHaveAttribute(
      'href',
      'https://ivanerricis.github.io/easysend/guide/data-location',
    );
    first.unmount();

    renderWithProviders(<StoragePage />, {
      session: makeAdmin(),
      route: '/admin/storage',
      routes: {
        'GET /api/admin/storage': makeStorage({ dataLocation: { hostPath: '/mnt/dati/easysend' } }),
      },
    });
    const bound = await screen.findByRole('region', { name: 'Where data is stored' });
    expect(within(bound).getByText('/mnt/dati/easysend')).toBeInTheDocument();
    expect(within(bound).queryByText('Docker volume easysend-data')).not.toBeInTheDocument();
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
