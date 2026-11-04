import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSubmissionDraft, loadSubmissionDraft } from '@/features/upload/submission';
import type { FileUploadOptions } from '@/features/upload/tus-file';
import { apiError, makePublicSettings, renderWithProviders } from '@/test/render';
import SubmitPage from './SubmitPage';

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

const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz0123456789';
const BASE = `/api/r/${TOKEN}`;
const INFO = `GET ${BASE}`;
const future = Math.floor(Date.now() / 1000) + 3 * 86_400;

function openInfo(overrides: Record<string, unknown> = {}) {
  return {
    locked: false,
    title: 'Contract documents',
    message: 'Line one\nLine two',
    ownerName: 'Ada Lovelace',
    requireName: false,
    requireEmail: false,
    remainingBytes: null,
    chunkSizeBytes: 26_214_400,
    maxFilesPerTransfer: 1000,
    expiresAt: future,
    ...overrides,
  };
}

const busyUpload = {
  id: 'u1',
  fileName: 'photo.jpg',
  path: '',
  totalSize: 11,
  status: 'processing',
  expiresAt: future,
};

const created = {
  transferId: 'tr1',
  submissionToken: 'sub-token-1',
  submissionTokenExpiresAt: future,
};

function happyRoutes(extra: Record<string, unknown> = {}) {
  return {
    [INFO]: openInfo(),
    [`POST ${BASE}/submissions`]: { status: 201, body: created },
    [`GET ${BASE}/submissions/tr1`]: {
      transferId: 'tr1',
      status: 'uploading',
      files: [],
      uploads: [],
    },
    [`POST ${BASE}/submissions/tr1/finalize`]: { transferId: 'tr1', fileCount: 1, totalBytes: 11 },
    [`DELETE ${BASE}/submissions/tr1`]: { status: 204 },
    ...extra,
  };
}

function renderPage(routes: Record<string, unknown>) {
  return renderWithProviders(
    <Routes>
      <Route path="/r/:token" element={<SubmitPage />} />
    </Routes>,
    {
      route: `/r/${TOKEN}`,
      publicSettings: makePublicSettings({
        appearance: { ...makePublicSettings().appearance, instanceName: 'Acme Share' },
      }),
      routes,
    },
  );
}

const photo = new File(['hello world'], 'photo.jpg', { type: 'image/jpeg', lastModified: 1 });

function pickFiles(files: File[]) {
  fireEvent.change(screen.getByTestId('file-input'), { target: { files } });
}

beforeEach(() => {
  uploads.calls.length = 0;
  clearSubmissionDraft(TOKEN);
});

describe('SubmitPage', () => {
  it('unlocks a protected request with the password and then shows the form', async () => {
    let unlocked = false;
    const { api } = renderPage({
      [INFO]: () => (unlocked ? openInfo() : { locked: true, expiresAt: future }),
      [`POST ${BASE}/unlock`]: () => {
        unlocked = true;
        return { status: 204 };
      },
    });
    await screen.findByRole('heading', { level: 1, name: /protected/i });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByRole('heading', { level: 1, name: 'Contract documents' });
    expect(api.callsTo(`POST ${BASE}/unlock`)[0]?.body).toEqual({ password: 'secret' });
  });

  it('shows an inline error for a wrong password', async () => {
    renderPage({
      [INFO]: { locked: true, expiresAt: future },
      [`POST ${BASE}/unlock`]: apiError(403, 'PASSWORD_INCORRECT'),
    });
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('The password you entered is incorrect.')).toBeInTheDocument();
  });

  it('shows the heading with the owner name, the instructions and the space left', async () => {
    renderPage({ [INFO]: openInfo({ remainingBytes: 1_048_576 }) });
    await screen.findByRole('heading', { level: 1, name: 'Contract documents' });
    expect(screen.getByText('Ada Lovelace is asking you for files')).toBeInTheDocument();
    const instructions = screen.getByText(/Line one/);
    expect(instructions.className).toContain('whitespace-pre-wrap');
    expect(screen.getAllByText(/^1([.,]0+)? ?M/).length).toBeGreaterThan(0);
  });

  it('falls back to the instance name when the owner has no display name', async () => {
    renderPage({ [INFO]: openInfo({ ownerName: null }) });
    expect(await screen.findByText('Acme Share is asking you for files')).toBeInTheDocument();
  });

  it.each([
    ['REQUEST_NOT_FOUND', 'Link not valid'],
    ['REQUEST_EXPIRED', 'Link expired'],
    ['REQUEST_REVOKED', 'Link closed'],
    ['REQUEST_FULL', 'No more uploads accepted'],
  ])('shows %s as a page message', async (code, title) => {
    renderPage({ [INFO]: apiError(code === 'REQUEST_NOT_FOUND' ? 404 : 410, code) });
    await screen.findByRole('heading', { level: 1, name: title });
  });

  it('requires name and email only when the request says so', async () => {
    const { api } = renderPage(
      happyRoutes({ [INFO]: openInfo({ requireName: true, requireEmail: true }) }),
    );
    await screen.findByLabelText('Your name');
    expect(screen.getByLabelText('Your email')).toBeInTheDocument();
    pickFiles([photo]);
    fireEvent.click(screen.getByRole('button', { name: 'Send files' }));
    expect((await screen.findAllByText('Enter your name.')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Enter your email address.').length).toBeGreaterThan(0);
    expect(api.callsTo(`POST ${BASE}/submissions`)).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Grace' } });
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send files' }));
    expect((await screen.findAllByText('Enter a valid email address.')).length).toBeGreaterThan(0);
    expect(api.callsTo(`POST ${BASE}/submissions`)).toHaveLength(0);
  });

  it('marks name and email as optional when they are not required', async () => {
    renderPage(happyRoutes());
    const name = await screen.findByLabelText(/Your name/);
    expect(name).not.toBeRequired();
    expect(screen.getByText('Your name').parentElement).toHaveTextContent('(optional)');
  });

  it('asks for a file before creating anything', async () => {
    const { api } = renderPage(happyRoutes());
    await screen.findByLabelText(/Your name/);
    fireEvent.click(screen.getByRole('button', { name: 'Send files' }));
    expect(await screen.findByText('Add at least one file.')).toBeVisible();
    expect(api.callsTo(`POST ${BASE}/submissions`)).toHaveLength(0);
  });

  it('blocks files larger than the space left', async () => {
    const { api } = renderPage(happyRoutes({ [INFO]: openInfo({ remainingBytes: 5 }) }));
    await screen.findByLabelText(/Your name/);
    pickFiles([photo]);
    expect(await screen.findByText(/larger than the space left/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send files' })).toBeDisabled();
    expect(api.callsTo(`POST ${BASE}/submissions`)).toHaveLength(0);
  });

  it('creates the submission, uploads with the submission token, waits, finalizes and confirms', async () => {
    let polls = 0;
    const { api } = renderPage(
      happyRoutes({
        [`GET ${BASE}/submissions/tr1`]: () => {
          polls += 1;
          return {
            transferId: 'tr1',
            status: 'uploading',
            files: [],
            uploads: polls === 1 ? [busyUpload] : [],
          };
        },
      }),
    );
    await screen.findByLabelText(/Your name/);
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: 'Grace' } });
    fireEvent.change(screen.getByLabelText(/Your email/), { target: { value: 'g@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: 'Here you go' } });
    pickFiles([photo]);
    fireEvent.click(screen.getByRole('button', { name: 'Send files' }));

    await screen.findByRole('heading', { level: 2, name: 'Files sent' }, { timeout: 8000 });
    expect(api.callsTo(`POST ${BASE}/submissions`)[0]?.body).toEqual({
      name: 'Grace',
      email: 'g@example.com',
      message: 'Here you go',
    });
    expect(uploads.calls).toHaveLength(1);
    expect(uploads.calls[0]?.transferId).toBe('tr1');
    expect(uploads.calls[0]?.headers).toEqual({ 'X-Submission-Token': 'sub-token-1' });
    expect(polls).toBeGreaterThanOrEqual(2);
    expect(api.callsTo(`GET ${BASE}/submissions/tr1`)[0]?.headers['X-Submission-Token']).toBe(
      'sub-token-1',
    );
    const finalize = api.callsTo(`POST ${BASE}/submissions/tr1/finalize`);
    expect(finalize).toHaveLength(1);
    expect(finalize[0]?.headers['X-Submission-Token']).toBe('sub-token-1');
    expect(screen.getByText(/1 file · 11 B delivered/)).toBeInTheDocument();
    expect(loadSubmissionDraft(TOKEN)).toBeNull();

    // "Send more" resets the form.
    fireEvent.click(screen.getByRole('button', { name: 'Send more files' }));
    expect(await screen.findByLabelText(/Your name/)).toHaveValue('');
  }, 15000);

  it('stores a draft while uploading and discards it when the request is gone', async () => {
    let closed = false;
    renderPage(
      happyRoutes({
        [INFO]: () => (closed ? apiError(410, 'REQUEST_EXPIRED') : openInfo()),
        [`POST ${BASE}/submissions/tr1/finalize`]: () => {
          closed = true;
          return apiError(410, 'REQUEST_EXPIRED');
        },
        [`GET ${BASE}/submissions/tr1`]: {
          transferId: 'tr1',
          status: 'uploading',
          files: [],
          uploads: [],
        },
      }),
    );
    await screen.findByLabelText(/Your name/);
    pickFiles([photo]);
    fireEvent.click(screen.getByRole('button', { name: 'Send files' }));
    // The expiry is reported as a page level message, not inside the progress panel.
    await screen.findByRole('heading', { level: 1, name: 'Link expired' });
    expect(loadSubmissionDraft(TOKEN)).toBeNull();
  });

  it('keeps a resumable draft with the submission token while the server encrypts', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { api } = renderPage(
      happyRoutes({
        [`GET ${BASE}/submissions/tr1`]: async () => {
          await pending;
          return {
            transferId: 'tr1',
            status: 'uploading',
            files: [],
            uploads: [busyUpload],
          };
        },
      }),
    );
    await screen.findByLabelText(/Your name/);
    pickFiles([photo]);
    fireEvent.click(screen.getByRole('button', { name: 'Send files' }));
    // The mocked upload finishes at once and the runner waits on the status poll.
    await waitFor(() => expect(loadSubmissionDraft(TOKEN)?.transferId).toBe('tr1'));
    expect(loadSubmissionDraft(TOKEN)?.submissionToken).toBe('sub-token-1');
    release();
    expect(api.callsTo(`POST ${BASE}/submissions`)).toHaveLength(1);
  });

  it('offers to resume a stored draft and continues it with the stored token', async () => {
    const stored = {
      transferId: 'tr1',
      submissionToken: 'sub-token-1',
      submissionTokenExpiresAt: future,
      files: [{ name: 'photo.jpg', size: 11, lastModified: 1 }],
      createdAt: Date.now(),
    };
    localStorage.setItem(`easysend-submission-${TOKEN}`, JSON.stringify(stored));
    const { api } = renderPage(happyRoutes());
    await screen.findByText('An upload was interrupted');
    fireEvent.click(screen.getByRole('button', { name: 'Select files and resume' }));
    fireEvent.change(screen.getByTestId('resume-input'), { target: { files: [photo] } });
    await screen.findByRole('heading', { level: 2, name: 'Files sent' }, { timeout: 8000 });
    expect(api.callsTo(`POST ${BASE}/submissions`)).toHaveLength(0);
    expect(uploads.calls[0]?.headers).toEqual({ 'X-Submission-Token': 'sub-token-1' });
  }, 15000);
});
