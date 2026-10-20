import { staticConfig } from '@easysend/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_STORAGE_KEY, loadDraft, saveDraft } from '@/features/upload/draft';
import { makeTransferDetail } from '@/features/upload/fixtures';
import type { FileUploadOptions } from '@/features/upload/tus-file';
import { apiError, makeUser, renderWithProviders } from '@/test/render';
import NewTransferPage from './NewTransferPage';

const uploads = vi.hoisted(() => ({ calls: [] as FileUploadOptions[] }));
vi.mock('@/features/upload/tus-file', () => ({
  createFileUpload: (options: FileUploadOptions) => {
    uploads.calls.push(options);
    options.onProgress(options.file.size, options.file.size);
    return {
      promise: Promise.resolve(),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(() => Promise.resolve()),
    };
  },
}));

const config = { chunkSizeBytes: 5_000_000, ...staticConfig };
const draftTransfer = makeTransferDetail({
  id: 'draft1',
  status: 'uploading',
  shareUrl: null,
  files: [],
});

function baseRoutes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/config': config,
    'GET /api/me': { user: makeUser(), usedBytes: 0, quotaBytes: null },
    ...extra,
  };
}

function pickFiles(files: File[]) {
  fireEvent.change(screen.getByTestId('file-input'), { target: { files } });
}

async function renderPage(extra: Record<string, unknown> = {}) {
  const view = renderWithProviders(<NewTransferPage />, {
    session: makeUser(),
    routes: baseRoutes(extra),
  });
  await screen.findByRole('button', { name: 'Choose files' });
  return view;
}

const photo = new File(['hello world'], 'photo.jpg', { type: 'image/jpeg', lastModified: 1 });

beforeEach(() => {
  uploads.calls.length = 0;
});

describe('NewTransferPage form', () => {
  it('lists the chosen files with their size and lets you remove them', async () => {
    await renderPage();
    pickFiles([photo]);
    const list = await screen.findByRole('list', { name: 'Selected files' });
    expect(within(list).getByText('photo.jpg')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo.jpg' }));
    expect(screen.queryByRole('list', { name: 'Selected files' })).not.toBeInTheDocument();
  });

  it('shows recipients only in email mode and requires at least one', async () => {
    const { api } = await renderPage();
    expect(screen.queryByLabelText('Recipients')).not.toBeInTheDocument();
    pickFiles([photo]);
    fireEvent.click(screen.getByRole('radio', { name: 'Send by email' }));
    expect(screen.getByLabelText('Recipients')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findAllByText('Add at least one recipient.')).length).toBeGreaterThan(0);
    expect(api.callsTo('POST /api/transfers')).toHaveLength(0);
  });

  it('adds several recipients at once and rejects invalid or duplicate ones', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('radio', { name: 'Send by email' }));
    const input = screen.getByLabelText('Recipients');
    fireEvent.change(input, { target: { value: 'a@example.com, B@example.com; A@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const list = await screen.findByRole('list', { name: 'Added recipients' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.paste(input, {
      clipboardData: { getData: () => 'c@example.com\nd@example.com' },
    });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(4));
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(
      (await screen.findAllByText('"not-an-email" is not a valid email address.')).length,
    ).toBeGreaterThan(0);
  });

  it('checks the minimum password length', async () => {
    const { api } = await renderPage();
    pickFiles([photo]);
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect((await screen.findAllByText(/at least 8 characters/)).length).toBeGreaterThan(0);
    expect(api.callsTo('POST /api/transfers')).toHaveLength(0);
  });

  it('asks for a file before creating anything', async () => {
    const { api } = await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByText('Add at least one file.')).toBeVisible();
    expect(api.callsTo('POST /api/transfers')).toHaveLength(0);
  });

  it('warns and blocks when the files exceed the remaining space', async () => {
    await renderPage({
      'GET /api/me': { user: makeUser(), usedBytes: 90, quotaBytes: 100 },
    });
    pickFiles([new File([new Uint8Array(50)], 'big.bin', { lastModified: 2 })]);
    expect(await screen.findByText(/larger than the space you have left/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create link' })).toBeDisabled();
  });
});

describe('NewTransferPage upload flow', () => {
  it('creates the draft, uploads, waits for encryption, finalizes and shows the link', async () => {
    let polls = 0;
    const { api } = await renderPage({
      'POST /api/transfers': { status: 201, body: draftTransfer },
      'GET /api/transfers/draft1': () => {
        polls += 1;
        return draftTransfer;
      },
      'POST /api/transfers/draft1/finalize': makeTransferDetail({
        id: 'draft1',
        shareUrl: 'http://localhost:8080/d/secret-token',
        fileCount: 1,
        totalBytes: 11,
      }),
    });
    pickFiles([photo]);
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Holiday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));

    expect(await screen.findByRole('heading', { name: 'Your transfer is ready' })).toBeVisible();
    expect(screen.getByLabelText('Download link')).toHaveValue(
      'http://localhost:8080/d/secret-token',
    );
    expect(screen.getByRole('link', { name: 'View transfer' })).toHaveAttribute(
      'href',
      '/transfers/draft1',
    );
    expect(screen.getByRole('button', { name: 'New transfer' })).toBeInTheDocument();

    const [create] = api.callsTo('POST /api/transfers');
    expect(create?.body).toEqual({ mode: 'link', expiresIn: '1w', title: 'Holiday' });
    expect(uploads.calls).toHaveLength(1);
    expect(uploads.calls[0]).toMatchObject({ transferId: 'draft1', chunkSize: 5_000_000 });
    expect(polls).toBeGreaterThanOrEqual(1);
    expect(api.callsTo('POST /api/transfers/draft1/finalize')).toHaveLength(1);
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('stores the draft (without the password) while the upload runs', async () => {
    let storedDuringUpload: string | null = null;
    await renderPage({
      'POST /api/transfers': { status: 201, body: draftTransfer },
      'GET /api/transfers/draft1': () => {
        storedDuringUpload = window.localStorage.getItem(DRAFT_STORAGE_KEY);
        return draftTransfer;
      },
      'POST /api/transfers/draft1/finalize': makeTransferDetail({ id: 'draft1' }),
    });
    pickFiles([photo]);
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    await screen.findByRole('heading', { name: 'Your transfer is ready' });
    expect(storedDuringUpload).toContain('draft1');
    expect(storedDuringUpload).toContain('photo.jpg');
    expect(storedDuringUpload).not.toContain('correct horse');
  });

  it('shows the encrypting state while the server processes the files', async () => {
    let busy = true;
    await renderPage({
      'POST /api/transfers': { status: 201, body: draftTransfer },
      'GET /api/transfers/draft1': () =>
        busy
          ? makeTransferDetail({
              id: 'draft1',
              status: 'uploading',
              uploads: [
                {
                  id: 'u1',
                  fileName: 'photo.jpg',
                  totalSize: 11,
                  status: 'processing',
                  expiresAt: 4_100_000_000,
                },
              ],
            })
          : draftTransfer,
      'POST /api/transfers/draft1/finalize': makeTransferDetail({ id: 'draft1' }),
    });
    pickFiles([photo]);
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByRole('heading', { name: 'Encrypting files…' })).toBeVisible();
    const bar = screen.getByRole('progressbar', { name: 'Total progress' });
    expect(bar).toHaveAttribute('aria-valuetext', expect.stringContaining('100%'));
    busy = false;
    await screen.findByRole('heading', { name: 'Your transfer is ready' }, { timeout: 4000 });
  }, 10_000);

  it('shows a clear message and a way back when creating the transfer is rate limited', async () => {
    await renderPage({ 'POST /api/transfers': apiError(429, 'RATE_LIMITED') });
    pickFiles([photo]);
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many requests/);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the form' }));
    expect(await screen.findByRole('button', { name: 'Create link' })).toBeInTheDocument();
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
  });
});

describe('NewTransferPage interrupted upload', () => {
  const draft = {
    transferId: 'draft1',
    values: {
      mode: 'link' as const,
      title: 'Holiday',
      message: '',
      recipients: [],
      expiresIn: '1w' as const,
      maxDownloads: '',
    },
    files: [
      { name: 'done.txt', size: 4, lastModified: 1 },
      { name: 'photo.jpg', size: 11, lastModified: 1 },
    ],
    createdAt: 1,
  };
  const serverDraft = makeTransferDetail({
    id: 'draft1',
    status: 'uploading',
    shareUrl: null,
    files: [
      {
        id: 'f1',
        name: 'done.txt',
        sizeBytes: 4,
        mimeType: null,
        sha256: 'b'.repeat(64),
        createdAt: 1,
      },
    ],
  });

  it('offers to resume, asks for the missing files and continues the same draft', async () => {
    saveDraft(draft);
    const { api } = await renderPage({
      'GET /api/transfers/draft1': serverDraft,
      'POST /api/transfers/draft1/finalize': makeTransferDetail({ id: 'draft1' }),
    });
    expect(await screen.findByText('An upload was interrupted')).toBeVisible();
    expect(screen.getByText('— already uploaded')).toBeVisible();

    fireEvent.change(screen.getByTestId('resume-input'), {
      target: { files: [new File(['other'], 'wrong.txt')] },
    });
    expect(
      await screen.findByText(/Files not found among the ones you selected: photo\.jpg/),
    ).toBeVisible();
    expect(uploads.calls).toHaveLength(0);

    fireEvent.change(screen.getByTestId('resume-input'), {
      target: { files: [new File(['hello world'], 'photo.jpg', { lastModified: 99 })] },
    });
    expect(await screen.findByRole('heading', { name: 'Your transfer is ready' })).toBeVisible();
    expect(api.callsTo('POST /api/transfers')).toHaveLength(0);
    expect(uploads.calls.map((c) => [c.transferId, c.file.name])).toEqual([
      ['draft1', 'photo.jpg'],
    ]);
    expect(loadDraft()).toBeNull();
  });

  it('discards the draft after confirmation', async () => {
    saveDraft(draft);
    const { api } = await renderPage({
      'GET /api/transfers/draft1': serverDraft,
      'DELETE /api/transfers/draft1': { status: 204 },
    });
    await screen.findByText('An upload was interrupted');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(api.callsTo('DELETE /api/transfers/draft1')).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByText('An upload was interrupted')).not.toBeInTheDocument(),
    );
    expect(loadDraft()).toBeNull();
  });

  it('forgets a draft that no longer exists on the server', async () => {
    saveDraft(draft);
    await renderPage({ 'GET /api/transfers/draft1': apiError(404, 'TRANSFER_NOT_FOUND') });
    await waitFor(() => expect(loadDraft()).toBeNull());
    expect(screen.queryByText('An upload was interrupted')).not.toBeInTheDocument();
  });
});
