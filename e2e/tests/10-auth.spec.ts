// Authentication: login with 2FA (wrong then right code), recovery code, logout, forgotten
// password through the email link (2FA still required afterwards) and the language switch.
import { checkA11y } from '../support/a11y.ts';
import { expect, test } from '../support/fixtures.ts';
import { deleteAllMessages, extractUrl, waitForMessage } from '../support/mailpit.ts';
import { requireAdmin, updateState } from '../support/state.ts';
import { nextTotp } from '../support/totp.ts';
import { login, logout, pickOption, saveSession } from '../support/ui.ts';

test.describe.configure({ mode: 'serial' });

const NEW_PASSWORD = 'Brand-New-Passphrase-99';

test('login with 2FA: wrong code is rejected, right code signs in, logout', async ({
  page,
  problems,
}) => {
  problems.allow(/status of 401/);
  const admin = requireAdmin();
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible();
  await checkA11y(page, 'login');

  await page.getByLabel('Email', { exact: true }).fill(admin.email);
  await page.getByLabel(/^Password/).fill(admin.password);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verifica in due passaggi' })).toBeVisible();
  await checkA11y(page, 'login-2fa');

  await page.getByLabel('Codice di autenticazione').first().fill('000000');
  await expect(page.getByRole('alert').filter({ hasText: /codice/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Verifica in due passaggi' })).toBeVisible();

  await page
    .getByLabel('Codice di autenticazione')
    .first()
    .fill(await nextTotp(admin.totpSecret));
  await expect(page.getByRole('heading', { name: 'Invia file' })).toBeVisible();
  await checkA11y(page, 'new-transfer-empty');

  await logout(page);
  // The session is really gone: a protected page sends us back to the login.
  await page.goto('/transfers');
  await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible();
});

test('login with a recovery code (single use)', async ({ page, problems }) => {
  problems.allow(/status of 401/);
  const admin = requireAdmin();
  const code = admin.recoveryCodes?.[0];
  if (!code) throw new Error('No recovery code in the state');

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(admin.email);
  await page.getByLabel(/^Password/).fill(admin.password);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await page.getByRole('button', { name: 'Usa invece un codice di recupero' }).click();
  await expect(
    page.getByRole('heading', { name: 'Accedi con un codice di recupero' }),
  ).toBeVisible();
  await checkA11y(page, 'login-recovery');
  await page.getByLabel('Codice di recupero').fill(code);
  await page.getByRole('button', { name: 'Verifica' }).click();

  // After using a code the app warns how many are left before continuing.
  const heading = page.getByRole('heading', { name: 'Invia file' });
  const warning = page.getByRole('heading', { name: 'Codice di recupero usato' });
  await expect(heading.or(warning)).toBeVisible();
  if (await warning.isVisible()) {
    await page.getByRole('button', { name: 'Continua su EasySend' }).click();
  }
  await expect(heading).toBeVisible();
  await logout(page);

  // The same code cannot be used twice.
  await page.getByLabel('Email', { exact: true }).fill(admin.email);
  await page.getByLabel(/^Password/).fill(admin.password);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await page.getByRole('button', { name: 'Usa invece un codice di recupero' }).click();
  await page.getByLabel('Codice di recupero').fill(code);
  await page.getByRole('button', { name: 'Verifica' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Invia file' })).toBeHidden();
});

test('forgotten password: email link, new password, 2FA still required', async ({
  page,
  problems,
}) => {
  problems.allow(/status of 4dd/);
  const admin = requireAdmin();
  await deleteAllMessages();

  await page.goto('/login');
  await page.getByRole('link', { name: 'Hai dimenticato la password?' }).click();
  await expect(page.getByRole('heading', { name: 'Password dimenticata' })).toBeVisible();
  await checkA11y(page, 'forgot-password');
  await page.getByLabel('Email', { exact: true }).fill(admin.email);
  await page.getByRole('button', { name: 'Invia il link di reimpostazione' }).click();
  await expect(page.getByRole('heading', { name: 'Controlla la tua email' })).toBeVisible();

  const mail = await waitForMessage(admin.email, /reimposta|reset/i);
  const link = extractUrl(mail, /reset/i);
  expect(link.startsWith('http://localhost:18090/')).toBe(true);

  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Scegli una nuova password' })).toBeVisible();
  await checkA11y(page, 'reset-password');
  await page.getByLabel('Nuova password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Conferma password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Salva la nuova password' }).click();
  await expect(page.getByRole('heading', { name: 'Password aggiornata' })).toBeVisible();
  updateState((state) => {
    if (state.admin) state.admin.password = NEW_PASSWORD;
  });

  // The link is single use.
  await page.goto(link);
  await page.getByLabel('Nuova password', { exact: true }).fill('Another-Passphrase-123');
  await page.getByLabel('Conferma password').fill('Another-Passphrase-123');
  await page.getByRole('button', { name: 'Salva la nuova password' }).click();
  await expect(page.getByRole('heading', { name: 'Link non valido' })).toBeVisible();

  // The old password no longer works; the new one still asks for the second factor.
  const fresh = requireAdmin();
  await login(page, fresh);
  await saveSession(page, 'admin');
});

test('language switch to English on the public login page', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible();
  await pickOption(page, page.getByRole('combobox', { name: 'Lingua' }), /English/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await checkA11y(page, 'login-en');
});
