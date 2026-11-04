// Folders in transfers: a nested folder (with a .DS_Store that must be skipped) is picked with the
// folder input, sent, browsed as a tree on the public page, downloaded as one file (leaf name) and
// as a zip that recreates the structure; the admin limit on files per transfer blocks a larger
// selection; the "Ricevi file" guest page offers the folder picker too.
import type { Page } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkA11y } from '../support/a11y.ts';
import { filesDir, sha256Of } from '../support/files.ts';
import { expect, test } from '../support/fixtures.ts';
import { requireValue, updateState } from '../support/state.ts';
import { downloadVia, escapeRegExp, submitTransfer } from '../support/transfers.ts';
import { hashFile, sessionFile } from '../support/ui.ts';
import { readZip } from '../support/zip.ts';

test.use({ storageState: sessionFile('admin') });
test.describe.configure({ mode: 'serial' });

const ROOT = join(filesDir, 'folders-spec');
const FOLDER = 'project';
const MIB = 1024 * 1024;

function bytes(seed: string, size: number): Buffer {
  return Buffer.alloc(size, seed);
}

const tree = [
  { rel: 'a.txt', content: bytes('a', 1500) },
  { rel: 'img/b.bin', content: bytes('b', MIB + 17) },
  { rel: 'img/deep/c.txt', content: bytes('c', 2222) },
  { rel: '.DS_Store', content: bytes('x', 64) },
];
const sent = tree.filter((f) => f.rel !== '.DS_Store');

function writeFolder() {
  rmSync(ROOT, { recursive: true, force: true });
  for (const { rel, content } of tree) {
    const path = join(ROOT, FOLDER, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

function remember(key: string, value: string) {
  updateState((state) => {
    state.values[key] = value;
  });
}

async function setMaxFiles(page: Page, value: string) {
  await page.goto('/admin/settings/general');
  const input = page.getByLabel('File massimi per trasferimento');
  await expect(input).toBeVisible();
  await input.fill(value);
  await page.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByText('Impostazioni salvate.').first()).toBeVisible();
}

test('a picked folder is grouped, system files are skipped, and it uploads', async ({ page }) => {
  writeFolder();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Invia file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scegli cartella' })).toBeVisible();
  await page.getByTestId('folder-input').setInputFiles(join(ROOT, FOLDER));

  const list = page.getByRole('list', { name: 'File selezionati' });
  await expect(list.getByRole('button', { name: new RegExp(`^${FOLDER} .*3 file`) })).toBeVisible();
  await expect(list.getByText('.DS_Store')).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Rimuovi cartella ${FOLDER}` })).toBeVisible();
  await list.getByRole('button', { name: new RegExp(`^${FOLDER} `) }).click();
  await expect(list.getByText('img/deep/c.txt')).toBeVisible();
  await page.getByLabel('Titolo').fill('Cartella E2E');
  await checkA11y(page, 'new-transfer-folder');

  const url = await submitTransfer(page);
  remember('shareFolder', url);
  await checkA11y(page, 'folder-upload-success');

  await page.getByRole('link', { name: 'Vedi trasferimento' }).click();
  await expect(page.getByRole('heading', { name: 'Cartella E2E' }).first()).toBeVisible();
  const rows = page.getByTestId('folder-row');
  await expect(rows.first()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(`SHA-256 ${sha256Of(sent[2]!.content).slice(0, 12)}…`)).toBeVisible();
  await checkA11y(page, 'transfer-detail-folder');
});

test('the public page shows the tree; one file and the zip are byte-identical', async ({
  newSession,
}) => {
  const page = await newSession();
  await page.goto(requireValue('shareFolder'));
  await expect(page.getByRole('heading', { name: 'Cartella E2E' })).toBeVisible();
  const rows = page.getByTestId('folder-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText(FOLDER);
  await expect(rows.first()).toHaveAttribute('aria-expanded', 'true');
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-expanded', 'false');
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-expanded', 'true');
  await checkA11y(page, 'download-folder-tree');

  const deep = page.getByRole('link', {
    name: new RegExp(`^Scarica ${escapeRegExp(`${FOLDER}/img/deep/c.txt`)} `),
  });
  const [download] = await Promise.all([page.waitForEvent('download'), deep.click()]);
  expect(download.suggestedFilename()).toBe('c.txt');
  const single = join(filesDir, '..', 'downloads', 'folder-c.txt');
  await download.saveAs(single);
  expect(await hashFile(single)).toBe(sha256Of(sent[2]!.content));

  const zipPath = await downloadVia(
    page,
    () => page.getByRole('link', { name: 'Scarica tutto in ZIP' }).click(),
    'folder.zip',
  );
  const entries = await readZip(zipPath);
  expect(entries.map((e) => e.name).sort()).toEqual(sent.map((f) => `${FOLDER}/${f.rel}`).sort());
  const byName = new Map(entries.map((e) => [e.name, e]));
  for (const f of sent) {
    expect(byName.get(`${FOLDER}/${f.rel}`)).toMatchObject({
      size: f.content.length,
      sha256: sha256Of(f.content),
    });
  }
});

test('the admin limit on files per transfer blocks a larger selection', async ({ page }) => {
  await setMaxFiles(page, '2');
  try {
    await page.goto('/');
    await expect(page.getByText('Fino a 2 file per trasferimento')).toBeVisible();
    await page.getByTestId('folder-input').setInputFiles(join(ROOT, FOLDER));
    await expect(page.getByText(/il limite è 2 file per trasferimento/).first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'File selezionati' })).toContainText('2 file');
    await checkA11y(page, 'new-transfer-over-limit');
  } finally {
    await setMaxFiles(page, '1000');
  }
});

test('the "Ricevi file" guest page offers the folder picker', async ({ page, newSession }) => {
  await page.goto('/requests');
  await page.getByRole('button', { name: 'Nuova richiesta' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Titolo/).fill('Cartelle dagli ospiti');
  await dialog.getByRole('button', { name: 'Crea', exact: true }).click();
  const url = await page.getByLabel('Link di invio').inputValue();

  const guest = await newSession();
  await guest.goto(url);
  await expect(guest.getByRole('button', { name: 'Scegli cartella' })).toBeVisible();
  await expect(guest.getByTestId('folder-input')).toBeAttached();
  await checkA11y(guest, 'submit-folder-picker');
});
