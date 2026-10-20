// Appearance: instance name, colours, footer and a PNG logo are saved by the admin and show up on
// the public login page of a visitor; "restore defaults" brings the original look back.
import { checkA11y } from '../support/a11y.ts';
import { createPng } from '../support/files.ts';
import { expect, test } from '../support/fixtures.ts';
import { sessionFile } from '../support/ui.ts';

test.use({ storageState: sessionFile('admin') });

const NAME = 'Acme Trasferimenti';
const FOOTER = 'Piè di pagina E2E';
const PRIMARY = '#1e3a8a';
const PRIMARY_RGB = 'rgb(30, 58, 138)';

test('custom appearance is applied to the public pages, then restored', async ({
  page,
  newSession,
}) => {
  const logo = createPng('logo-e2e.png', 200, 50, [29, 78, 216]);
  await page.goto('/admin/appearance');
  await expect(page.getByRole('heading', { name: 'Aspetto', exact: true }).first()).toBeVisible();
  await checkA11y(page, 'admin-appearance');

  await page.getByLabel("Nome dell'istanza", { exact: true }).fill(NAME);
  await page.getByLabel('Testo del piè di pagina').fill(FOOTER);
  await page.getByLabel('Colore primario', { exact: true }).fill(PRIMARY);
  await page.getByLabel('Colore di accento', { exact: true }).fill('#b91c1c');

  // Images are stored as soon as they are chosen.
  const logoInput = page
    .locator(
      'input[type="file"]#branding-logoLight, [data-testid="image-logoLight"] input[type="file"], input[type="file"][data-testid="image-logoLight"]',
    )
    .first();
  await logoInput.setInputFiles(logo.path);
  await expect(page.getByText('Logo (tema chiaro) aggiornato.')).toBeVisible();

  await page.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByText('Aspetto salvato.')).toBeVisible();
  await checkA11y(page, 'admin-appearance-saved');

  // A visitor sees the new identity on the public login page.
  const visitor = await newSession();
  await visitor.goto('/login');
  await expect(visitor.getByRole('heading', { name: 'Accedi' })).toBeVisible();
  await expect(visitor).toHaveTitle(new RegExp(NAME));
  await expect(visitor.getByText(FOOTER)).toBeVisible();
  const loginButton = visitor.getByRole('button', { name: 'Accedi', exact: true });
  await expect(loginButton).toHaveCSS('background-color', PRIMARY_RGB);
  const customLogo = visitor.locator('img[src*="logoLight"]').first();
  await expect(customLogo).toBeVisible();
  expect(await customLogo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await checkA11y(visitor, 'login-custom-appearance');

  // Restore the defaults. The API also drops the uploaded images (the UI text says they stay).
  await page.getByRole('button', { name: 'Ripristina i valori predefiniti' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Ripristina' }).click();
  await expect(page.getByText('Aspetto predefinito ripristinato.')).toBeVisible();
  await expect(page.getByLabel("Nome dell'istanza", { exact: true })).toHaveValue('EasySend');
  await expect(page.getByRole('button', { name: 'Rimuovi: Logo (tema chiaro)' })).toBeHidden();

  // Uploading again and removing the image from the page works too.
  await logoInput.setInputFiles(logo.path);
  await expect(page.getByText('Logo (tema chiaro) aggiornato.')).toBeVisible();
  await page.getByRole('button', { name: 'Rimuovi: Logo (tema chiaro)' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Rimuovi' }).click();
  await expect(page.getByText('Logo (tema chiaro) rimosso.')).toBeVisible();

  await visitor.reload();
  await expect(visitor.getByRole('heading', { name: 'Accedi' })).toBeVisible();
  await expect(visitor).toHaveTitle(/EasySend/);
  await expect(visitor.getByText(FOOTER)).toBeHidden();
  // The default colour comes from the stylesheet tokens (oklch), not from the custom value.
  await expect(visitor.getByRole('button', { name: 'Accedi', exact: true })).not.toHaveCSS(
    'background-color',
    PRIMARY_RGB,
  );
  await expect(visitor.locator('img[src*="logoLight"]')).toHaveCount(0);
  await checkA11y(visitor, 'login-default-appearance');
});
