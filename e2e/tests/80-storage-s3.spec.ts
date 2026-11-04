// Optional S3 storage (Settings -> Archiviazione) against MinIO from the test stack: a wrong secret
// key is rejected with a translated reason and saving stays blocked, a good configuration is tested
// and saved, a new transfer lands in the bucket (encrypted objects, rows with storage = 's3') and is
// downloadable byte for byte (file and zip), then the files are moved back to the local disk from
// the migration card and still download correctly. The instance ends on local storage so that later
// specs and screenshots are unaffected.
import type { Page } from '@playwright/test';
import { checkA11y } from '../support/a11y.ts';
import { composeExec, nodeInApi } from '../support/compose.ts';
import { createTestFile } from '../support/files.ts';
import { expect, test } from '../support/fixtures.ts';
import { createTransfer, downloadFileHash, downloadVia } from '../support/transfers.ts';
import { sessionFile } from '../support/ui.ts';
import { readZip } from '../support/zip.ts';

test.use({ storageState: sessionFile('admin') });
test.describe.configure({ mode: 'serial' });

const MIB = 1024 * 1024;
const TITLE = 'Archiviazione S3';
const BUCKET = 'easysend';
const PREFIX = 'e2e';
const ACCESS_KEY = 'easysend-e2e-key';
const SECRET_KEY = 'easysend-e2e-secret-0123456789';

const big = createTestFile('s3-grande.bin', 6 * MIB + 123);
const small = createTestFile('s3-piccolo.txt', 2048);

/** Share link of the transfer created by the third test, reused after the migration. */
let shareUrl = '';

interface FileRow {
  original_name: string;
  storage_name: string;
  storage: string;
}

function fileRows(): FileRow[] {
  const result = nodeInApi(`
    const Database = require('better-sqlite3');
    const db = new Database('/data/db/app.sqlite', { readonly: true });
    const rows = db.prepare("SELECT f.original_name, f.storage_name, f.storage FROM transfer_files f JOIN transfers t ON t.id = f.transfer_id WHERE t.title = ? ORDER BY f.original_name").all(${JSON.stringify(TITLE)});
    console.log('ROWS=' + JSON.stringify(rows));
  `);
  const match = /ROWS=(.*)/.exec(result.stdout);
  expect(match, result.stdout + result.stderr).not.toBeNull();
  return JSON.parse(match?.[1] ?? '[]') as FileRow[];
}

/** Object names (without the prefix) that MinIO currently holds under the test prefix. */
function bucketObjects(): string[] {
  const result = composeExec('minio', [
    'sh',
    '-c',
    `MC_HOST_e2e=http://${ACCESS_KEY}:${SECRET_KEY}@127.0.0.1:9000 mc --config-dir /tmp/mc ls --recursive e2e/${BUCKET}/${PREFIX}/`,
  ]);
  expect(result.status, result.stderr).toBe(0);
  return result.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/).at(-1) ?? '')
    .filter(Boolean);
}

async function openStoragePage(page: Page) {
  await page.goto('/admin/settings/storage');
  await expect(
    page.getByRole('heading', { name: 'Archiviazione dei file', exact: true }),
  ).toBeVisible();
}

async function fillS3(page: Page, secret: string) {
  await page.getByRole('radio', { name: /Archiviazione compatibile S3/ }).click();
  await page.getByLabel(/^Endpoint/).fill('http://minio:9000');
  await page.getByLabel(/^Regione/).fill('us-east-1');
  await page.getByLabel(/^Bucket/).fill(BUCKET);
  await page.getByLabel(/^Prefisso/).fill(PREFIX);
  const pathStyle = page.getByRole('switch', { name: /path-style/ });
  if ((await pathStyle.getAttribute('aria-checked')) !== 'true') await pathStyle.click();
  await page.getByLabel(/^Access key ID/).fill(ACCESS_KEY);
  await page.getByLabel(/^Secret access key/).fill(secret);
}

test('a wrong secret key is rejected with a reason and saving stays blocked', async ({ page }) => {
  await openStoragePage(page);
  await expect(page.getByRole('radio', { name: /^Disco locale/ })).toBeChecked();
  await checkA11y(page, 'storage-settings-local');

  await fillS3(page, 'questa-secret-key-e-sbagliata');
  await expect(page.getByRole('button', { name: 'Salva', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Prova connessione' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'La prova di connessione è fallita' }),
  ).toContainText('le chiavi o la regione non sono corrette');
  await expect(page.getByRole('button', { name: 'Salva', exact: true })).toBeDisabled();
});

test('a working configuration is tested, saved and the page stays accessible', async ({ page }) => {
  await openStoragePage(page);
  await fillS3(page, SECRET_KEY);
  await expect(page.getByRole('button', { name: 'Salva', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Prova connessione' }).click();
  await expect(page.getByText('La connessione funziona.')).toBeVisible();
  await checkA11y(page, 'storage-settings-s3-tested');

  // Editing a tested value invalidates the test.
  await page.getByLabel(/^Regione/).fill('us-east-2');
  await expect(page.getByText('I valori sono cambiati dopo la prova')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salva', exact: true })).toBeDisabled();
  await page.getByLabel(/^Regione/).fill('us-east-1');
  await page.getByRole('button', { name: 'Prova connessione' }).click();
  await expect(page.getByText('La connessione funziona.')).toBeVisible();

  await page.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByText('Impostazioni salvate.').first()).toBeVisible();

  // Reloaded from the server: S3 is the active storage, the secret is write-only.
  await openStoragePage(page);
  await expect(page.getByRole('radio', { name: /Archiviazione compatibile S3/ })).toBeChecked();
  await expect(page.getByLabel(/^Endpoint/)).toHaveValue('http://minio:9000');
  await expect(page.getByText('Una secret key è già salvata')).toBeVisible();
  await expect(page.getByLabel(/^Secret access key/)).toHaveValue('');
  await checkA11y(page, 'storage-settings-s3-saved');
});

test('a new transfer is stored encrypted in the bucket and downloads correctly', async ({
  page,
  newSession,
}) => {
  const before = bucketObjects();
  const url = await createTransfer(page, { files: [big.path, small.path], title: TITLE });
  shareUrl = url;

  const rows = fileRows();
  expect(rows.map((row) => [row.original_name, row.storage])).toEqual([
    [big.name, 's3'],
    [small.name, 's3'],
  ]);
  const objects = bucketObjects();
  for (const row of rows) {
    expect(objects, `object ${row.storage_name} in the bucket`).toContain(row.storage_name);
    expect(before).not.toContain(row.storage_name);
  }

  const visitor = await newSession();
  await visitor.goto(url);
  await expect(visitor.getByRole('heading', { name: TITLE })).toBeVisible();
  expect(await downloadFileHash(visitor, big.name, 's3-single-big.bin')).toBe(big.sha256);
  expect(await downloadFileHash(visitor, small.name, 's3-single-small.txt')).toBe(small.sha256);
  const zipPath = await downloadVia(
    visitor,
    () => visitor.getByRole('link', { name: 'Scarica tutto in ZIP' }).click(),
    's3-all.zip',
  );
  const entries = await readZip(zipPath);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  expect(byName.get(big.name)).toMatchObject({ size: big.size, sha256: big.sha256 });
  expect(byName.get(small.name)).toMatchObject({ size: small.size, sha256: small.sha256 });
  await visitor.context().close();
});

test('switching to the local disk and migrating moves the files back', async ({
  page,
  newSession,
}) => {
  await openStoragePage(page);
  await page.getByRole('radio', { name: /^Disco locale/ }).click();
  await page.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByText('Impostazioni salvate.').first()).toBeVisible();

  const card = page.getByRole('region', { name: 'Sposta i file tra le archiviazioni' });
  await expect(card).toContainText('ancora su S3');
  await checkA11y(page, 'storage-migration-ready');
  await card.getByRole('button', { name: /^Sposta .* sul disco locale$/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Avvia lo spostamento' }).click();
  await expect(card.getByText(/^Spostamento completato/)).toBeVisible({ timeout: 120_000 });
  await expect(card).toContainText("Tutti i file sono già sull'archiviazione in uso");

  const rows = fileRows();
  expect(rows.map((row) => row.storage)).toEqual(['local', 'local']);
  // The S3 originals are not deleted at once (grace period): they are queued for deletion.
  const queued = nodeInApi(`
    const Database = require('better-sqlite3');
    const db = new Database('/data/db/app.sqlite', { readonly: true });
    console.log('QUEUED=' + db.prepare("SELECT count(*) AS n FROM storage_deletions WHERE storage = 's3'").get().n);
  `);
  expect(Number(/QUEUED=(\d+)/.exec(queued.stdout)?.[1])).toBeGreaterThanOrEqual(2);

  // Still downloadable from the local disk, byte for byte.
  const visitor = await newSession();
  await visitor.goto(shareUrl);
  expect(await downloadFileHash(visitor, big.name, 'local-single-big.bin')).toBe(big.sha256);
  expect(await downloadFileHash(visitor, small.name, 'local-single-small.txt')).toBe(small.sha256);
  const zipPath = await downloadVia(
    visitor,
    () => visitor.getByRole('link', { name: 'Scarica tutto in ZIP' }).click(),
    'local-all.zip',
  );
  expect((await readZip(zipPath)).map((entry) => entry.sha256).sort()).toEqual(
    [big.sha256, small.sha256].sort(),
  );
  await visitor.context().close();
  await openStoragePage(page);
  await expect(page.getByRole('radio', { name: /^Disco locale/ })).toBeChecked();
  await checkA11y(page, 'storage-settings-back-to-local');
});
