import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, makeAdmin, renderWithProviders } from '@/test/render';
import { chooseOption } from '@/test/select';
import { UpdatesSection } from './UpdatesSection';

const versions = [
  {
    version: '0.3.0',
    releaseUrl: 'https://github.com/ivanerricis/easysend/releases/tag/v0.3.0',
    publishedAt: 1_790_000_000,
  },
  {
    version: '0.2.0',
    releaseUrl: 'https://github.com/ivanerricis/easysend/releases/tag/v0.2.0',
    publishedAt: 1_780_000_000,
  },
];

const updateStatus = {
  enabled: true,
  currentVersion: '0.1.0',
  latestVersion: '0.3.0',
  updateAvailable: true,
  releaseUrl: 'https://github.com/ivanerricis/easysend/releases/tag/v0.3.0',
  publishedAt: 1_790_000_000,
  checkedAt: 1_790_000_100,
  availableVersions: versions,
  status: 'ok',
};

const runStatus = (overrides: Record<string, unknown> = {}) => ({
  id: 'run-1',
  targetVersion: '0.3.0',
  fromVersion: '0.1.0',
  state: 'running',
  step: 'backup',
  error: null,
  startedAt: 1_790_000_000,
  updatedAt: 1_790_000_010,
  finishedAt: null,
  ...overrides,
});

const runResponse = (overrides: Record<string, unknown> = {}) => ({
  runner: 'installed',
  pending: null,
  run: null,
  ...overrides,
});

const pendingRequest = (overrides: Record<string, unknown> = {}) => ({
  id: 'run-1',
  version: '0.3.0',
  requestedAt: 1_790_000_000,
  stale: false,
  ...overrides,
});

function renderUpdates(run: unknown, extra: Record<string, unknown> = {}) {
  return renderWithProviders(<UpdatesSection />, {
    session: makeAdmin(),
    routes: {
      'GET /api/admin/updates': updateStatus,
      'GET /api/admin/updates/run': run,
      ...extra,
    },
  });
}

const RUN_KEY = ['admin', 'updates', 'run'];

describe('UpdatesSection: one-click update', () => {
  it('shows the install command when the update service is missing', async () => {
    renderUpdates(runResponse({ runner: 'missing' }));
    const commands = await screen.findByLabelText('Commands to install the update service');
    expect(commands).toHaveTextContent('sudo ./scripts/update-service.sh install');
    expect(screen.getByRole('link', { name: /How the update service works/ })).toHaveAttribute(
      'href',
      'https://ivanerricis.github.io/easysend/guide/updates#one-click-update',
    );
    expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull();
    expect(screen.getByLabelText('Commands to run on the server')).toBeInTheDocument();
  });

  it('offers no button in local mode', async () => {
    renderUpdates(runResponse({ runner: 'local' }));
    await screen.findByText('Update available');
    expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull();
    expect(screen.queryByLabelText('Commands to install the update service')).toBeNull();
    expect(screen.getByLabelText('Commands to run on the server')).toBeInTheDocument();
  });

  it('selects the newest version and confirms before starting', async () => {
    const { api } = renderUpdates(runResponse(), {
      'POST /api/admin/updates/run': {
        status: 202,
        body: { id: 'run-1', version: '0.2.0', requestedAt: 1_790_000_000 },
      },
    });
    const select = await screen.findByRole('combobox', { name: 'Version to install' });
    expect(select).toHaveTextContent('0.3.0');
    await chooseOption('Version to install', /0\.2\.0/);
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Update from 0.1.0 to 0.2.0?')).toBeInTheDocument();
    expect(within(dialog).getByText(/unreachable for a few minutes/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Release notes for 0\.2\.0/ })).toHaveAttribute(
      'href',
      'https://github.com/ivanerricis/easysend/releases/tag/v0.2.0',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(api.callsTo('POST /api/admin/updates/run')).toHaveLength(1));
    expect(api.callsTo('POST /api/admin/updates/run')[0]?.body).toEqual({ version: '0.2.0' });
    expect(await screen.findByTestId('update-progress')).toBeInTheDocument();
  });

  it('shows the error when an update is already running', async () => {
    renderUpdates(runResponse(), {
      'POST /api/admin/updates/run': apiError(409, 'UPDATE_IN_PROGRESS'),
    });
    await screen.findByRole('combobox', { name: 'Version to install' });
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((await screen.findAllByText(/update is already/i)).length).toBeGreaterThan(0);
  });

  it('shows a waiting request as the first step', async () => {
    renderUpdates(runResponse({ pending: pendingRequest() }));
    const panel = await screen.findByTestId('update-progress');
    expect(within(panel).getByText('Updating to 0.3.0')).toBeInTheDocument();
    expect(within(panel).getByText(/Step 1 of 7: Request sent to the server/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull();
  });

  it('shows the current step of a running update', async () => {
    renderUpdates(runResponse({ run: runStatus({ step: 'pull' }) }));
    const panel = await screen.findByTestId('update-progress');
    expect(within(panel).getByText(/Step 5 of 7: Downloading the images/)).toBeInTheDocument();
    const current = within(panel)
      .getAllByRole('listitem')
      .find((item) => item.getAttribute('aria-current') === 'step');
    expect(current).toHaveTextContent('Downloading the images (in progress)');
  });

  it('warns when the update service does not pick the request up', async () => {
    renderUpdates(runResponse({ pending: pendingRequest({ stale: true }) }), {
      'POST /api/admin/updates/run': {
        status: 202,
        body: { id: 'run-2', version: '0.3.0', requestedAt: 1_790_000_300 },
      },
    });
    expect(await screen.findByText('The update service is not responding')).toBeInTheDocument();
    expect(screen.getByLabelText('Commands to check the update service')).toHaveTextContent(
      'sudo ./scripts/update-service.sh status',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Request again' }));
    await waitFor(() =>
      expect(screen.queryByText('The update service is not responding')).toBeNull(),
    );
  });

  it('offers a reload after a successful update', async () => {
    renderUpdates(
      runResponse({ run: runStatus({ state: 'succeeded', step: 'done', finishedAt: 1 }) }),
    );
    expect(await screen.findByText('Updated to 0.3.0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  });

  it('says when the instance was already on that version', async () => {
    renderUpdates(
      runResponse({
        run: runStatus({
          state: 'succeeded',
          step: 'done',
          error: 'already_current',
          finishedAt: 1,
        }),
      }),
    );
    expect(await screen.findByText('Already on version 0.3.0')).toBeInTheDocument();
  });

  it('explains a rolled back update', async () => {
    renderUpdates(
      runResponse({ run: runStatus({ state: 'rolled_back', step: 'done', finishedAt: 1 }) }),
    );
    expect(await screen.findByText('The update to 0.3.0 failed')).toBeInTheDocument();
    expect(screen.getByText(/went back to 0\.1\.0/)).toBeInTheDocument();
    expect(screen.getByText('/opt/easysend/.deploy/update.log')).toBeInTheDocument();
  });

  it('explains a failed update by error code', async () => {
    renderUpdates(
      runResponse({
        run: runStatus({ state: 'failed', step: 'backup', error: 'backup', finishedAt: 1 }),
      }),
    );
    expect(await screen.findByText(/database backup failed/)).toBeInTheDocument();
    expect(screen.getByText('/opt/easysend/.deploy/update.log')).toBeInTheDocument();
  });

  it('keeps the last state while the services restart', async () => {
    let unavailable = false;
    const { queryClient } = renderUpdates(() =>
      unavailable ? apiError(503, 'SERVICE_UNAVAILABLE') : runResponse({ run: runStatus() }),
    );
    await screen.findByText(/Step 4 of 7/);
    unavailable = true;
    await queryClient.refetchQueries({ queryKey: RUN_KEY });
    expect(
      await screen.findByText(/Restarting… this page reconnects by itself/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Step 4 of 7/)).toBeInTheDocument();
    unavailable = false;
    await queryClient.refetchQueries({ queryKey: RUN_KEY });
    await waitFor(() => expect(screen.queryByText(/Restarting…/)).toBeNull());
  });
});
