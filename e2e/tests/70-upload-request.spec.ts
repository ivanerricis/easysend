// Upload requests ("Ricevi file"): the owner creates a password-protected request with a size
// limit, an anonymous visitor unlocks the public page and uploads two files, the owner is emailed
// and finds the received transfer (sender visible, no resend) whose zip is byte-identical; the
// size limit is enforced and a revoked request shows the "closed" page.
import { checkA11y } from '../support/a11y.ts';
import { createTestFile } from '../support/files.ts';
import { expect, test } from '../support/fixtures.ts';
import { deleteAllMessages, extractUrl, waitForMessage } from '../support/mailpit.ts';
import { requireAdmin, requireValue, updateState } from '../support/state.ts';
import { downloadVia } from '../support/transfers.ts';
import { pickOption, sessionFile } from '../support/ui.ts';
import { readZip } from '../support/zip.ts';

test.use({ storageState: sessionFile('admin') });
test.describe.configure({ mode: 'serial' });

const MIB = 1024 * 1024;
const REQUEST_TITLE = 'Documenti per il commercialista';
const UPLOAD_PASSWORD = 'invio-segreto-123';
const SUBMITTER = 'Marta Bianchi';
const SUBMITTER_EMAIL = 'marta.bianchi@example.com';

const invoice = createTestFile('fattura.pdf', MIB + 321);
const receipt = createTestFile('ricevuta.txt', 4096);
const tooBig = createTestFile('troppo-grande.bin', 4 * MIB);

function remember(key: string, value: string) {
  updateState((state) => {
    state.values[key] = value;
  });
}

test('the owner creates a request with a password and a size limit', async ({ page }) => {
  await page.goto('/requests');
  await expect(page.getByRole('heading', { name: 'Ricevi file' })).toBeVisible();
  await checkA11y(page, 'requests-empty');

  await page.getByRole('button', { name: 'Nuova richiesta' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Titolo/).fill(REQUEST_TITLE);
  await dialog.getByLabel(/^Istruzioni/).fill('Carica le fatture del trimestre.');
  await dialog.getByLabel(/^Password/).fill(UPLOAD_PASSWORD);
  await dialog.getByLabel(/^Dimensione massima totale/).fill('5');
  await pickOption(page, dialog.getByRole('combobox', { name: 'Unità' }), 'MiB');
  await checkA11y(page, 'request-dialog');
  await dialog.getByRole('button', { name: 'Crea', exact: true }).click();

  const link = page.getByLabel('Link di invio');
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  expect(url).toMatch(/^http:\/\/localhost:18090\/r\/[\w-]+$/);
  remember('requestUrl', url);
  await expect(page.getByRole('link', { name: REQUEST_TITLE })).toBeVisible();
  await checkA11y(page, 'requests-list');
});

test('an anonymous visitor unlocks the page and uploads two files', async ({
  newSession,
  problems,
}) => {
  problems.allow(/status of 4\d\d/);
  await deleteAllMessages();
  const page = await newSession();
  await page.goto(requireValue('requestUrl'));
  await expect(page.getByText('Questo link di caricamento è protetto')).toBeVisible();
  await checkA11y(page, 'submit-locked');

  await page.getByLabel(/^Password/).fill('sbagliata-12345');
  await page.getByRole('button', { name: 'Sblocca' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /password/i })).toBeVisible();
  await expect(page.getByText('Questo link di caricamento è protetto')).toBeVisible();

  await page.getByLabel(/^Password/).fill(UPLOAD_PASSWORD);
  await page.getByRole('button', { name: 'Sblocca' }).click();
  await expect(page.getByText('Carica le fatture del trimestre.')).toBeVisible();
  await checkA11y(page, 'submit-unlocked');

  await page.getByLabel(/^Il tuo nome/).fill(SUBMITTER);
  await page.getByLabel(/^La tua email/).fill(SUBMITTER_EMAIL);
  await page.getByLabel(/^Messaggio/).fill('Ecco i documenti richiesti.');
  await page.getByTestId('file-input').setInputFiles([invoice.path, receipt.path]);
  await page.getByRole('button', { name: 'Invia i file' }).click();

  await expect(page.getByRole('heading', { name: 'File inviati' })).toBeVisible({
    timeout: 120_000,
  });
  await checkA11y(page, 'submit-success');
});

test('the owner is emailed and sees the received transfer', async ({ page }) => {
  const admin = requireAdmin();
  const mail = await waitForMessage(admin.email, /nuovi file ricevuti/i);
  expect(mail.Subject).toContain(REQUEST_TITLE);
  expect(mail.Text).toContain(SUBMITTER);
  expect(mail.Text).toContain(REQUEST_TITLE);
  expect(extractUrl(mail, /\/transfers\//)).toContain('/transfers/');

  await page.goto('/transfers');
  await pickOption(page, page.locator('#transfers-source'), /^Ricevuti$/);
  await page
    .getByRole('link', { name: new RegExp(REQUEST_TITLE) })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: REQUEST_TITLE }).first()).toBeVisible();
  await expect(page.getByText(SUBMITTER, { exact: true })).toBeVisible();
  await expect(page.getByText(SUBMITTER_EMAIL)).toBeVisible();
  await expect(page.getByText('Ecco i documenti richiesti.')).toBeVisible();
  await expect(page.getByRole('button', { name: "Reinvia l'email" })).toHaveCount(0);
  await checkA11y(page, 'received-transfer-detail');
  remember('receivedUrl', await page.locator('#share-url').inputValue());
});

test('the received files download byte-identical in a zip', async ({ newSession }) => {
  const page = await newSession();
  await page.goto(requireValue('receivedUrl'));
  await expect(page.getByRole('heading', { name: REQUEST_TITLE })).toBeVisible();
  const zipPath = await downloadVia(
    page,
    () => page.getByRole('link', { name: 'Scarica tutto in ZIP' }).click(),
    'received.zip',
  );
  const entries = await readZip(zipPath);
  expect(entries.map((e) => e.name).sort()).toEqual([invoice.name, receipt.name].sort());
  const byName = new Map(entries.map((e) => [e.name, e]));
  expect(byName.get(invoice.name)).toMatchObject({ size: invoice.size, sha256: invoice.sha256 });
  expect(byName.get(receipt.name)).toMatchObject({ size: receipt.size, sha256: receipt.sha256 });
});

test('files over the remaining space are refused', async ({ newSession }) => {
  const page = await newSession();
  await page.goto(requireValue('requestUrl'));
  await page.getByLabel(/^Password/).fill(UPLOAD_PASSWORD);
  await page.getByRole('button', { name: 'Sblocca' }).click();
  await expect(page.getByText('Carica le fatture del trimestre.')).toBeVisible();

  // 5 MiB in total, about 1 MiB already used: 4 MiB no longer fit.
  await page.getByLabel(/^Il tuo nome/).fill(SUBMITTER);
  await page.getByLabel(/^La tua email/).fill(SUBMITTER_EMAIL);
  await page.getByTestId('file-input').setInputFiles([tooBig.path]);
  await expect(page.getByText(/superano lo spazio rimasto/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invia i file' })).toBeDisabled();
});

test('a revoked request shows the closed page', async ({ page, newSession }) => {
  await page.goto('/requests');
  await page.getByRole('link', { name: REQUEST_TITLE }).click();
  await expect(page.getByRole('heading', { name: REQUEST_TITLE }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Revoca', exact: true }).click();
  await checkA11y(page, 'request-revoke-dialog');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoca' }).click();
  await expect(page.getByText('Richiesta revocata').first()).toBeVisible();

  const visitor = await newSession();
  await visitor.goto(requireValue('requestUrl'));
  await expect(visitor.getByRole('heading', { name: 'Link chiuso' })).toBeVisible();
  await checkA11y(visitor, 'submit-revoked');
});
