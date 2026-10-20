// Helpers for creating and downloading transfers through the UI.
import { expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { outputDir } from './paths.ts';
import { hashFile, waitForShareUrl } from './ui.ts';

export interface NewTransferOptions {
  /** Absolute paths of the files to send. */
  files: string[];
  title?: string;
  message?: string;
  password?: string;
  maxDownloads?: number;
  /** Switches to "send by email" with these recipients. */
  recipients?: string[];
}

/** Fills the "Invia file" form (does not submit). */
export async function fillTransferForm(page: Page, options: NewTransferOptions): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Invia file' })).toBeVisible();
  await page.getByTestId('file-input').setInputFiles(options.files);
  if (options.recipients) {
    await page.getByRole('radio', { name: /Invia per email/ }).click();
    const input = page.getByLabel('Destinatari', { exact: true });
    for (const recipient of options.recipients) {
      await input.fill(recipient);
      await input.press('Enter');
    }
  }
  if (options.title) await page.getByLabel('Titolo').fill(options.title);
  if (options.message) await page.getByLabel('Messaggio').fill(options.message);
  if (options.password) await page.getByLabel(/^Password/).fill(options.password);
  if (options.maxDownloads) {
    await page.getByLabel('Limite di download').fill(String(options.maxDownloads));
  }
}

/** Submits the form (link or email mode) and returns the share URL once the transfer is ready. */
export async function submitTransfer(page: Page): Promise<string> {
  await page.getByRole('button', { name: /^(Crea link|Invia)$/ }).click();
  return waitForShareUrl(page);
}

export async function createTransfer(page: Page, options: NewTransferOptions): Promise<string> {
  await fillTransferForm(page, options);
  return submitTransfer(page);
}

/** Clicks a download link/button and returns the path of the saved file. */
export async function downloadVia(
  page: Page,
  click: () => Promise<void>,
  saveAs: string,
): Promise<string> {
  const path = join(outputDir, 'downloads', saveAs);
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  await download.saveAs(path);
  return path;
}

export async function downloadFileHash(
  page: Page,
  fileName: string,
  saveAs: string,
): Promise<string> {
  const path = await downloadVia(
    page,
    () =>
      page.getByRole('link', { name: new RegExp(`^Scarica ${escapeRegExp(fileName)} `) }).click(),
    saveAs,
  );
  return hashFile(path);
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
