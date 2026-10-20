// UI helpers shared by the specs. Selectors are role/label based and in Italian (the project uses
// it-IT); they work for both native controls and their shadcn/Radix replacements.
import { expect, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { outputDir } from './paths.ts';
import type { Account } from './state.ts';
import { nextTotp } from './totp.ts';

export const authDir = join(outputDir, 'auth');

/** Path of the saved browser session (cookies) of an account. */
export const sessionFile = (key: string) => join(authDir, `${key}.json`);

/** Picks an option of a select, whether it is a native `<select>` or a Radix Select. */
export async function pickOption(page: Page, select: Locator, optionName: string | RegExp) {
  const isNative = await select.evaluate((el) => el.tagName === 'SELECT');
  if (isNative) {
    const label = await select
      .locator('option')
      .filter({ hasText: optionName })
      .first()
      .textContent();
    await select.selectOption({ label: label ?? '' });
    return;
  }
  await select.click();
  await page.getByRole('option', { name: optionName }).click();
}

/** Fills the first step of the login form and, if the account has 2FA, the authenticator code. */
export async function login(page: Page, account: Account): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  if (account.totpSecret) {
    await expect(page.getByRole('heading', { name: 'Verifica in due passaggi' })).toBeVisible();
    await page
      .getByLabel('Codice di autenticazione')
      .first()
      .fill(await nextTotp(account.totpSecret));
  }
  await expect(page.getByRole('heading', { name: 'Invia file' })).toBeVisible();
}

/** Opens the user menu and signs out. */
export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Menu utente/ }).click();
  await page.getByRole('menuitem', { name: 'Esci' }).click();
  await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible();
}

/** Logs in and stores the session under `key`, for later specs (`storageState`). */
export async function saveSession(page: Page, key: string): Promise<void> {
  mkdirSync(authDir, { recursive: true });
  await page.context().storageState({ path: sessionFile(key) });
}

/** SHA-256 (hex) of a file on disk, streamed. */
export function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/** Waits for the success panel of a new transfer and returns the share URL. */
export async function waitForShareUrl(page: Page): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Il tuo trasferimento è pronto' })).toBeVisible({
    timeout: 120_000,
  });
  const url = await page.locator('#share-url').inputValue();
  expect(url).toContain('/d/');
  return url;
}
