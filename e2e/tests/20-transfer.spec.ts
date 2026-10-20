// Transfers: multi-file upload with an interrupted request, reload in the middle of an upload and
// resume from the stored offset, password-protected link, single-file and zip downloads checked
// byte by byte, email mode with the first-download notification, download limit, revoke.
import { checkA11y } from '../support/a11y.ts';
import { createTestFile } from '../support/files.ts';
import { expect, test } from '../support/fixtures.ts';
import { deleteAllMessages, extractUrl, waitForMessage } from '../support/mailpit.ts';
import { requireAdmin, requireValue, updateState } from '../support/state.ts';
import {
  createTransfer,
  downloadFileHash,
  downloadVia,
  fillTransferForm,
  submitTransfer,
} from '../support/transfers.ts';
import { sessionFile } from '../support/ui.ts';
import { readZip } from '../support/zip.ts';

test.use({ storageState: sessionFile('admin') });
test.describe.configure({ mode: 'serial' });

const MIB = 1024 * 1024;
const LINK_PASSWORD = 'segreta-12345';

const notes = createTestFile('note.txt', 2048);
const photo = createTestFile('foto-grande.bin', 6 * MIB + 123);
const empty = createTestFile('vuoto.txt', 0);

function remember(key: string, value: string) {
  updateState((state) => {
    state.values[key] = value;
  });
}

test('upload of several files; an aborted PATCH is retried by tus', async ({ page, problems }) => {
  problems.allow(/ERR_FAILED|net::/);
  let bigPatches = 0;
  let aborted = 0;
  let creations = 0;
  await page.route(/\/api\/uploads/, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') creations += 1;
    if (request.method() === 'PATCH' && (request.postDataBuffer()?.length ?? 0) >= MIB) {
      bigPatches += 1;
      if (bigPatches === 3) {
        aborted += 1;
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });

  await fillTransferForm(page, {
    files: [notes.path, photo.path, empty.path],
    title: 'Documenti E2E',
    message: 'Tre file, uno grande.',
  });
  await expect(page.getByText(photo.name).first()).toBeVisible();
  await checkA11y(page, 'new-transfer-filled');
  const shareUrl = await submitTransfer(page);
  await checkA11y(page, 'upload-success');

  expect(aborted).toBe(1);
  // One tus upload per file: the retry resumed the same upload instead of creating a new one.
  expect(creations).toBe(3);
  // 6 MiB at 1 MiB per request: the aborted chunk was sent again.
  expect(bigPatches).toBeGreaterThanOrEqual(7);
  remember('shareMulti', shareUrl);

  // The server stored exactly what was sent: the detail page shows the SHA-256 of the big file.
  await page.getByRole('link', { name: 'Vedi trasferimento' }).click();
  await expect(page.getByRole('heading', { name: 'Documenti E2E' }).first()).toBeVisible();
  await expect(page.getByText(`SHA-256 ${photo.sha256.slice(0, 12)}…`)).toBeVisible();
  await checkA11y(page, 'transfer-detail');
});

test('public download: one file and the zip are byte-identical', async ({ newSession }) => {
  const page = await newSession();
  await page.goto(requireValue('shareMulti'));
  await expect(page.getByRole('heading', { name: 'Documenti E2E' })).toBeVisible();
  await expect(page.getByText('Tre file, uno grande.')).toBeVisible();
  await checkA11y(page, 'download-page');

  expect(await downloadFileHash(page, photo.name, 'single-foto-grande.bin')).toBe(photo.sha256);

  const zipPath = await downloadVia(
    page,
    () => page.getByRole('link', { name: 'Scarica tutto in ZIP' }).click(),
    'all.zip',
  );
  const entries = await readZip(zipPath);
  expect(entries.map((e) => e.name).sort()).toEqual([empty.name, photo.name, notes.name].sort());
  const byName = new Map(entries.map((e) => [e.name, e]));
  expect(byName.get(photo.name)).toMatchObject({ size: photo.size, sha256: photo.sha256 });
  expect(byName.get(notes.name)).toMatchObject({ size: notes.size, sha256: notes.sha256 });
  expect(byName.get(empty.name)).toMatchObject({ size: 0 });
});

test('reload in the middle of an upload: resume from the stored offset', async ({ page }) => {
  const small = createTestFile('piccolo.txt', 50_000);
  const big = createTestFile('grande.bin', 6 * MIB);
  let bigPatches = 0;
  let hold = true;
  await page.route(/\/api\/uploads/, async (route) => {
    const request = route.request();
    if (hold && request.method() === 'PATCH' && (request.postDataBuffer()?.length ?? 0) >= MIB) {
      bigPatches += 1;
      // The third chunk never leaves the browser: the server holds exactly 2 MiB.
      if (bigPatches === 3) return;
    }
    await route.continue();
  });

  await fillTransferForm(page, {
    files: [small.path, big.path],
    title: 'Con ripresa',
    password: LINK_PASSWORD,
  });
  await page.getByRole('button', { name: 'Crea link' }).click();
  await expect.poll(() => bigPatches, { timeout: 60_000 }).toBe(3);

  // The small file is stored; only the big one is partial.
  const transferId = await page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('easysend-draft') ?? '{}') as { transferId?: string })
        .transferId,
  );
  expect(transferId).toBeTruthy();
  await expect
    .poll(async () => {
      const detail = (await (await page.request.get(`/api/transfers/${transferId}`)).json()) as {
        files: unknown[];
      };
      return detail.files.length;
    })
    .toBe(1);

  hold = false;
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Un caricamento è stato interrotto' }),
  ).toBeVisible();
  await expect(page.getByText(/già caricato/)).toBeVisible();
  await expect(page.getByText(/da selezionare di nuovo/)).toBeVisible();
  await checkA11y(page, 'resume-banner');

  const requests: { method: string; offset: string | undefined; url: string }[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/uploads')) {
      requests.push({
        method: request.method(),
        offset: request.headers()['upload-offset'],
        url: request.url(),
      });
    }
  });
  // The same files, from disk (same name, size and modification time).
  await page.getByTestId('resume-input').setInputFiles([small.path, big.path]);
  await expect(page.getByRole('heading', { name: 'Il tuo trasferimento è pronto' })).toBeVisible({
    timeout: 120_000,
  });
  const shareUrl = await page.locator('#share-url').inputValue();
  remember('shareResume', shareUrl);

  expect(requests.filter((r) => r.method === 'POST')).toEqual([]);
  const firstPatch = requests.find((r) => r.method === 'PATCH');
  expect(Number(firstPatch?.offset)).toBeGreaterThanOrEqual(MIB);
  expect(Number(firstPatch?.offset)).toBeLessThan(big.size);
  remember('resumeBigSha', big.sha256);
  remember('resumeBigName', big.name);
});

test('password-protected link: wrong password, then the right one; file intact', async ({
  newSession,
  problems,
}) => {
  problems.allow(/status of 4\d\d/);
  const page = await newSession();
  await page.goto(requireValue('shareResume'));
  await expect(page.getByText('Questo trasferimento è protetto')).toBeVisible();
  await checkA11y(page, 'download-locked');

  await page.getByLabel(/^Password/).fill('sbagliata-12345');
  await page.getByRole('button', { name: 'Sblocca' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /password/i })).toBeVisible();
  await expect(page.getByText('Questo trasferimento è protetto')).toBeVisible();

  await page.getByLabel(/^Password/).fill(LINK_PASSWORD);
  await page.getByRole('button', { name: 'Sblocca' }).click();
  await expect(page.getByRole('heading', { name: 'Con ripresa' })).toBeVisible();
  await checkA11y(page, 'download-unlocked');

  const name = requireValue('resumeBigName');
  expect(await downloadFileHash(page, name, 'resumed-grande.bin')).toBe(
    requireValue('resumeBigSha'),
  );
});

test('email mode: recipient gets the link, sender is told about the first download', async ({
  page,
  newSession,
}) => {
  const admin = requireAdmin();
  const recipient = 'destinataria@example.com';
  await deleteAllMessages();

  await fillTransferForm(page, {
    files: [notes.path],
    title: 'Per Chiara',
    message: 'Ecco la nota.',
    recipients: [recipient],
  });
  await checkA11y(page, 'new-transfer-email-mode');
  await submitTransfer(page);
  await expect(page.getByText(recipient)).toBeVisible();

  const mail = await waitForMessage(recipient, /ti ha inviato|sent you/i);
  expect(mail.Text).toContain('Ecco la nota.');
  expect(mail.Text).not.toContain(LINK_PASSWORD);
  const link = extractUrl(mail, /\/d\//);
  expect(link.startsWith('http://localhost:18090/d/')).toBe(true);

  const visitor = await newSession();
  await visitor.goto(link);
  await expect(visitor.getByRole('heading', { name: 'Per Chiara' })).toBeVisible();
  expect(await downloadFileHash(visitor, notes.name, 'email-note.txt')).toBe(notes.sha256);

  const notice = await waitForMessage(admin.email, /scaricato|downloaded/i);
  expect(notice.Subject).toContain('Per Chiara');
  // Only one notification, whatever the number of downloads.
  expect(extractUrl(notice, /\/transfers\//)).toContain('/transfers/');
});

test('download limit: the second download is refused', async ({ page, newSession }) => {
  const url = await createTransfer(page, {
    files: [notes.path],
    title: 'Un solo download',
    maxDownloads: 1,
  });
  const visitor = await newSession();
  await visitor.goto(url);
  await expect(visitor.getByText(/1 usati su 1|0 usati su 1/)).toBeVisible();
  await expect(visitor.getByText('Resta un solo download.', { exact: false })).toBeVisible();
  expect(await downloadFileHash(visitor, notes.name, 'limit-note.txt')).toBe(notes.sha256);

  await visitor.reload();
  await expect(
    visitor.getByRole('heading', { name: 'Limite di download raggiunto' }),
  ).toBeVisible();
  await checkA11y(visitor, 'download-limit');
  // The owner sees the counter too.
  await page.goto('/transfers');
  await expect(page.getByRole('link', { name: 'Un solo download' })).toBeVisible();
});

test('revoke: the link stops working', async ({ page, newSession }) => {
  await page.goto('/transfers');
  await page.getByRole('link', { name: 'Documenti E2E' }).first().click();
  await expect(page.getByRole('heading', { name: 'Documenti E2E' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Revoca', exact: true }).click();
  await checkA11y(page, 'revoke-dialog');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoca' }).click();
  await expect(page.getByText('Trasferimento revocato').first()).toBeVisible();

  const visitor = await newSession();
  await visitor.goto(requireValue('shareMulti'));
  await expect(visitor.getByRole('heading', { name: 'Trasferimento revocato' })).toBeVisible();
  await checkA11y(visitor, 'download-revoked');
});
