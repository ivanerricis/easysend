import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, makeAdmin, renderWithProviders } from '@/test/render';
import StorageSettingsPage from './StorageSettingsPage';

const GIB = 1024 ** 3;

const S3 = {
  endpoint: 'https://s3.example.com',
  region: 'auto',
  bucket: 'files',
  prefix: 'easysend',
  forcePathStyle: true,
  accessKeyId: 'AKIA',
  hasSecret: true,
};

function settings(overrides: Record<string, unknown> = {}) {
  return {
    driver: 'local',
    s3: null,
    source: 'panel',
    envDiffers: false,
    usage: { local: { files: 3, bytes: GIB }, s3: { files: 0, bytes: 0 } },
    locked: { fields: [], reason: null },
    ...overrides,
  };
}

function migration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    target: 's3',
    status: 'running',
    totalFiles: 4,
    doneFiles: 1,
    totalBytes: 4 * GIB,
    doneBytes: GIB,
    failedFiles: 0,
    errorCode: null,
    startedAt: 1_790_000_000,
    updatedAt: 1_790_000_010,
    finishedAt: null,
    ...overrides,
  };
}

function renderPage(routes: Record<string, unknown> = {}) {
  return renderWithProviders(<StorageSettingsPage />, {
    session: makeAdmin(),
    route: '/admin/settings/storage',
    routes: {
      'GET /api/admin/settings/storage': settings(),
      'GET /api/admin/storage/migration': { migration: null },
      ...routes,
    },
  });
}

async function fillS3() {
  fireEvent.change(await screen.findByLabelText('Endpoint'), {
    target: { value: 'https://s3.example.com' },
  });
  fireEvent.change(screen.getByLabelText('Bucket'), { target: { value: 'files' } });
  fireEvent.change(screen.getByLabelText('Access key ID'), { target: { value: 'AKIA' } });
  fireEvent.change(screen.getByLabelText(/Secret access key/), { target: { value: 'shh' } });
}

describe('StorageSettingsPage form', () => {
  it('saves the local disk without a test', async () => {
    const { api } = renderPage({ 'PUT /api/admin/settings/storage': settings() });
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(screen.queryByRole('button', { name: 'Test connection' })).not.toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() => expect(api.callsTo('PUT /api/admin/settings/storage')).toHaveLength(1));
    expect(api.callsTo('PUT /api/admin/settings/storage')[0]?.body).toEqual({ driver: 'local' });
  });

  it('validates the S3 fields and keeps Save disabled until the connection test passes', async () => {
    const { api } = renderPage({
      'POST /api/admin/settings/storage/test': { ok: true },
      'PUT /api/admin/settings/storage': settings({ driver: 's3', s3: S3 }),
    });
    fireEvent.click(await screen.findByRole('radio', { name: /S3-compatible storage/ }));
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    // Empty fields: inline errors and no request.
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findAllByText('This field is required.')).not.toHaveLength(0);
    expect(api.callsTo('POST /api/admin/settings/storage/test')).toHaveLength(0);

    await fillS3();
    fireEvent.change(screen.getByLabelText('Bucket'), { target: { value: 'Bad Bucket' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findAllByText(/lowercase letters, digits/)).not.toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Bucket'), { target: { value: 'files' } });

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connection works.')).toBeInTheDocument();
    expect(save).toBeEnabled();

    // Any edit invalidates the test.
    fireEvent.change(screen.getByLabelText('Bucket'), { target: { value: 'other' } });
    expect(save).toBeDisabled();
    expect(screen.getByText(/The values changed after the test/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Bucket'), { target: { value: 'files' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await screen.findByText('Connection works.');
    fireEvent.click(save);
    await waitFor(() => expect(api.callsTo('PUT /api/admin/settings/storage')).toHaveLength(1));
    expect(api.callsTo('PUT /api/admin/settings/storage')[0]?.body).toMatchObject({
      driver: 's3',
      s3: { endpoint: 'https://s3.example.com', bucket: 'files', secretAccessKey: 'shh' },
    });
  });

  it('shows the translated reason of a failed test', async () => {
    renderPage({
      'POST /api/admin/settings/storage/test': {
        status: 502,
        body: {
          error: {
            code: 'STORAGE_TEST_FAILED',
            message: 'x',
            requestId: 'r',
            details: { reason: 'ACCESS_DENIED' },
          },
        },
      },
    });
    fireEvent.click(await screen.findByRole('radio', { name: /S3-compatible storage/ }));
    await fillS3();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(/access denied, check the keys/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('keeps the secret write-only: empty means keep the saved one', async () => {
    const { api } = renderPage({
      'GET /api/admin/settings/storage': settings({ driver: 's3', s3: S3 }),
      'POST /api/admin/settings/storage/test': { ok: true },
    });
    const secret = await screen.findByLabelText(/Secret access key/);
    expect(secret).toHaveValue('');
    expect(screen.getByText(/A secret key is saved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await screen.findByText('Connection works.');
    const body = api.callsTo('POST /api/admin/settings/storage/test')[0]?.body as {
      s3: Record<string, unknown>;
    };
    expect(body.s3).not.toHaveProperty('secretAccessKey');
    expect(body.s3).toMatchObject({ bucket: 'files', prefix: 'easysend', forcePathStyle: true });
  });

  it('requires a secret when none is saved', async () => {
    const { api } = renderPage({ 'POST /api/admin/settings/storage/test': { ok: true } });
    fireEvent.click(await screen.findByRole('radio', { name: /S3-compatible storage/ }));
    await fillS3();
    fireEvent.change(screen.getByLabelText(/Secret access key/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findAllByText('This field is required.')).not.toHaveLength(0);
    expect(api.callsTo('POST /api/admin/settings/storage/test')).toHaveLength(0);
  });

  it('disables the locked fields and explains how to unlock them', async () => {
    renderPage({
      'GET /api/admin/settings/storage': settings({
        driver: 's3',
        s3: S3,
        usage: { local: { files: 0, bytes: 0 }, s3: { files: 2, bytes: GIB } },
        locked: { fields: ['endpoint', 'bucket', 'prefix'], reason: 's3_has_files' },
      }),
    });
    expect(await screen.findByLabelText('Endpoint')).toBeDisabled();
    expect(screen.getByLabelText('Bucket')).toBeDisabled();
    expect(screen.getByLabelText(/Folder prefix/)).toBeDisabled();
    expect(screen.getByLabelText('Region')).toBeEnabled();
    expect(screen.getByText('Some fields are locked')).toBeInTheDocument();
  });

  it('shows STORAGE_IN_USE inline', async () => {
    renderPage({ 'PUT /api/admin/settings/storage': apiError(409, 'STORAGE_IN_USE') });
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Files are stored on S3/)).toBeInTheDocument();
  });

  it('warns when the .env settings differ from the active ones', async () => {
    renderPage({ 'GET /api/admin/settings/storage': settings({ envDiffers: true }) });
    expect(await screen.findByText('The .env storage settings are different')).toBeInTheDocument();
  });

  it('shows the files per storage', async () => {
    renderPage();
    const usage = await screen.findByRole('region', { name: 'Files by storage' });
    expect(within(usage).getByText('3 files, 1 GiB')).toBeInTheDocument();
    expect(within(usage).getByText('0 files, 0 B')).toBeInTheDocument();
  });
});

describe('StorageSettingsPage migration', () => {
  const s3Settings = settings({
    driver: 's3',
    s3: S3,
    usage: { local: { files: 4, bytes: 4 * GIB }, s3: { files: 0, bytes: 0 } },
  });

  it('confirms, starts the move and shows the progress with a stop button', async () => {
    const { api } = renderPage({
      'GET /api/admin/settings/storage': s3Settings,
      'POST /api/admin/storage/migration': { status: 202, body: { migration: migration() } },
      'POST /api/admin/storage/migration/cancel': {
        migration: migration({ status: 'cancelling' }),
      },
    });
    const start = await screen.findByRole('button', { name: 'Move 4 files (4 GiB) to S3' });
    fireEvent.click(start);
    const dialog = await screen.findByRole('alertdialog');
    expect(api.callsTo('POST /api/admin/storage/migration')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start moving' }));

    const progress = await screen.findByTestId('migration-progress');
    expect(api.callsTo('POST /api/admin/storage/migration')[0]?.body).toEqual({ target: 's3' });
    expect(within(progress).getByRole('progressbar')).toHaveAttribute('aria-valuetext', '25%');
    expect(within(progress).getByText('1 of 4 files, 1 GiB of 4 GiB')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    fireEvent.click(within(progress).getByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('Stopping after the current file…')).toBeInTheDocument();
    expect(within(progress).getByRole('button', { name: 'Stop' })).toBeDisabled();
  });

  it('polls while running and shows the outcome when it is done', async () => {
    let calls = 0;
    const { api } = renderPage({
      'GET /api/admin/settings/storage': settings({
        driver: 'local',
        s3: S3,
        usage: { local: { files: 0, bytes: 0 }, s3: { files: 4, bytes: 4 * GIB } },
      }),
      'GET /api/admin/storage/migration': () => {
        calls += 1;
        return {
          migration:
            calls < 2
              ? migration({ target: 'local' })
              : migration({
                  target: 'local',
                  status: 'done',
                  doneFiles: 4,
                  doneBytes: 4 * GIB,
                  finishedAt: 1_790_000_100,
                }),
        };
      },
    });
    expect(await screen.findByTestId('migration-progress')).toBeInTheDocument();
    expect(
      await screen.findByText(
        'The move is complete: 4 files moved to the local disk.',
        {},
        {
          timeout: 5000,
        },
      ),
    ).toBeInTheDocument();
    expect(api.callsTo('GET /api/admin/storage/migration').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('migration-progress')).not.toBeInTheDocument();
  });

  it('shows a failed move with the translated error and the failed count', async () => {
    renderPage({
      'GET /api/admin/storage/migration': {
        migration: migration({
          status: 'failed',
          errorCode: 'INSUFFICIENT_DISK_SPACE',
          failedFiles: 2,
          finishedAt: 1_790_000_100,
        }),
      },
    });
    expect(await screen.findByText('The move failed.')).toBeInTheDocument();
    expect(screen.getByText(/does not have enough disk space/)).toBeInTheDocument();
    expect(screen.getByText('2 files could not be moved.')).toBeInTheDocument();
  });

  it('shows a stopped move', async () => {
    renderPage({
      'GET /api/admin/storage/migration': {
        migration: migration({ status: 'cancelled', doneFiles: 2, finishedAt: 1_790_000_100 }),
      },
    });
    expect(await screen.findByText(/2 of 4 files moved/)).toBeInTheDocument();
  });

  it('has nothing to start when no files are on the other storage', async () => {
    renderPage();
    expect(
      await screen.findByText('All files are already on the storage in use.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument();
  });

  it('disables the start when the target storage is not configured', async () => {
    renderPage({
      'GET /api/admin/settings/storage': settings({
        driver: 's3',
        s3: null,
        usage: { local: { files: 1, bytes: GIB }, s3: { files: 0, bytes: 0 } },
      }),
    });
    expect(await screen.findByRole('button', { name: /^Move 1 file/ })).toBeDisabled();
    expect(screen.getByText('Save the S3 configuration first.')).toBeInTheDocument();
  });
});
