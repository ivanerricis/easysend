// Admin panel: a user created with a quota and a welcome email, the quota enforced in the upload
// form, 2FA enrolment and reset, revoking another user's link, the storage page, disabling a user
// and deleting it with its transfers reassigned.
import { checkA11y } from '../support/a11y.ts';
import { createTestFile } from '../support/files.ts';
import { expect, test } from '../support/fixtures.ts';
import { deleteAllMessages, extractUrl, waitForMessage } from '../support/mailpit.ts';
import { requireAccount, requireAdmin, requireValue, updateState } from '../support/state.ts';
import type { Account } from '../support/state.ts';
import { nextTotp } from '../support/totp.ts';
import { createTransfer, fillTransferForm } from '../support/transfers.ts';
import { login, pickOption, sessionFile } from '../support/ui.ts';

test.use({ storageState: sessionFile('admin') });
test.describe.configure({ mode: 'serial' });

const MIB = 1024 * 1024;
const MEMBER: Account = {
  email: 'marco@example.com',
  displayName: 'Marco Bianchi',
  password: 'Another-Strong-Passphrase-7',
};

const small = createTestFile('di-marco.txt', 100_000);
const tooBig = createTestFile('troppo-grande.bin', 2 * MIB);

test('create a user with a quota: welcome email, password, first login', async ({
  page,
  newSession,
  problems,
}) => {
  problems.allow(/status of 4\d\d/);
  await deleteAllMessages();
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Utenti', exact: true }).first()).toBeVisible();
  await checkA11y(page, 'admin-users');

  await page.getByRole('button', { name: 'Nuovo utente' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill(MEMBER.email);
  await dialog.getByLabel('Nome visualizzato').fill(MEMBER.displayName);
  await dialog.getByLabel('Quota di spazio', { exact: true }).fill('1');
  await pickOption(page, dialog.getByLabel('Unità della quota'), 'MiB');
  await expect(dialog.getByText(/email di benvenuto/)).toBeVisible();
  await checkA11y(page, 'admin-create-user');
  await dialog.getByRole('button', { name: 'Crea', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(MEMBER.email).first()).toBeVisible();

  const mail = await waitForMessage(MEMBER.email, /benvenuto|welcome/i);
  const link = extractUrl(mail, /welcome/i);
  const visitor = await newSession();
  await visitor.goto(link);
  await expect(visitor.getByRole('heading', { name: 'Benvenuto' })).toBeVisible();
  await checkA11y(visitor, 'welcome');
  await visitor.getByLabel('Nuova password', { exact: true }).fill(MEMBER.password);
  await visitor.getByLabel('Conferma password').fill(MEMBER.password);
  await visitor.getByRole('button', { name: "Attiva l'account" }).click();
  await expect(visitor.getByRole('heading', { name: 'Account attivato' })).toBeVisible();

  updateState((state) => {
    state.accounts.member = MEMBER;
  });
  await login(visitor, MEMBER);
});

test('the quota is enforced in the form; a transfer within it works', async ({
  newSession,
  problems,
}) => {
  problems.allow(/status of 4\d\d/);
  const page = await newSession();
  await login(page, requireAccount('member'));
  await expect(page.getByText(/1 MiB/).first()).toBeVisible();

  await fillTransferForm(page, { files: [tooBig.path] });
  await expect(page.getByText(/superano lo spazio che ti resta/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crea link' })).toBeDisabled();
  await checkA11y(page, 'new-transfer-over-quota');

  const keepUrl = await createTransfer(page, { files: [small.path], title: 'Resta attivo' });
  const revokeUrl = await createTransfer(page, { files: [small.path], title: 'Da revocare' });
  updateState((state) => {
    state.values.memberKeepUrl = keepUrl;
    state.values.memberRevokeUrl = revokeUrl;
  });
});

test('the user enables 2FA; the admin resets it', async ({ page, newSession }) => {
  const member = requireAccount('member');
  const memberPage = await newSession();
  await login(memberPage, member);
  await memberPage.goto('/profile');
  await memberPage.getByRole('button', { name: 'Attiva la verifica in due passaggi' }).click();
  const secretBox = memberPage.locator('code.font-mono').first();
  await expect(secretBox).toBeVisible();
  const secret = ((await secretBox.textContent()) ?? '').replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  await checkA11y(memberPage, 'profile-2fa-setup');
  await memberPage
    .getByLabel("Codice dell'app")
    .first()
    .fill(await nextTotp(secret));
  await memberPage.getByRole('button', { name: 'Verifica e attiva' }).click();
  await memberPage.getByLabel('Ho salvato i codici di recupero in un posto sicuro').check();
  await memberPage.getByRole('button', { name: 'Fatto' }).click();
  await expect(memberPage.getByText('Attiva', { exact: true }).first()).toBeVisible();

  await page.goto('/admin/users');
  const resetButton = page.getByRole('button', { name: `Azzera il 2FA di ${member.email}` });
  await expect(resetButton).toBeVisible();
  await resetButton.click();
  await checkA11y(page, 'admin-reset-2fa-dialog');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Azzera 2FA' }).click();
  await expect(page.getByText(`2FA azzerato per ${member.email}.`)).toBeVisible();
  await expect(resetButton).toBeHidden();

  // The user was signed out everywhere and now needs only the password.
  await memberPage.goto('/transfers');
  await expect(memberPage.getByRole('heading', { name: 'Accedi' })).toBeVisible();
  await login(memberPage, member);
});

test("the admin revokes another user's link from all transfers", async ({ page, newSession }) => {
  await page.goto('/admin/transfers');
  await expect(page.getByRole('heading', { name: 'Tutti i trasferimenti' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Da revocare' }).first()).toBeVisible();
  await checkA11y(page, 'admin-transfers');
  await page.getByRole('link', { name: 'Da revocare' }).first().click();
  await expect(page.getByText(requireAccount('member').email).first()).toBeVisible();
  await page.getByRole('button', { name: 'Revoca', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoca' }).click();
  await expect(page.getByText('Trasferimento revocato').first()).toBeVisible();

  const visitor = await newSession();
  await visitor.goto(requireValue('memberRevokeUrl'));
  await expect(visitor.getByRole('heading', { name: 'Trasferimento revocato' })).toBeVisible();
});

test('storage page', async ({ page }) => {
  await page.goto('/admin/storage');
  await expect(page.getByRole('heading', { name: 'Spazio', exact: true }).first()).toBeVisible();
  await expect(page.getByText('Uso per utente')).toBeVisible();
  await expect(page.getByText(requireAccount('member').email).first()).toBeVisible();
  await checkA11y(page, 'admin-storage');
});

test('disable the user, then delete it reassigning its transfers', async ({
  page,
  newSession,
  problems,
}) => {
  problems.allow(/status of 4\d\d/);
  const member = requireAccount('member');
  await page.goto('/admin/users');
  await page.getByRole('button', { name: `Modifica ${member.email}` }).click();
  const edit = page.getByRole('dialog');
  await edit.getByRole('checkbox', { name: 'Disabilita questo account' }).click();
  await checkA11y(page, 'admin-edit-user');
  await edit.getByRole('button', { name: 'Salva' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('Disabilitato').first()).toBeVisible();

  // A disabled user cannot sign in (the answer is the same as for a wrong password).
  const memberPage = await newSession();
  await memberPage.goto('/login');
  await memberPage.getByLabel('Email', { exact: true }).fill(member.email);
  await memberPage.getByLabel(/^Password/).fill(member.password);
  await memberPage.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(memberPage.getByRole('alert').first()).toBeVisible();

  await page.getByRole('button', { name: `Elimina ${member.email}` }).click();
  const remove = page.getByRole('dialog');
  await remove.getByRole('radio', { name: /Assegnali a un altro utente/ }).click();
  await pickOption(page, remove.getByLabel('Nuovo proprietario'), requireAdmin().email);
  await checkA11y(page, 'admin-delete-user');
  await remove.getByRole('button', { name: 'Elimina utente' }).click();
  await expect(page.getByText(`${member.email} eliminato.`)).toBeVisible();
  await expect(page.getByRole('button', { name: `Elimina ${member.email}` })).toBeHidden();

  // The transfer survived and now belongs to the admin; its link still works.
  await page.goto('/transfers');
  await expect(page.getByRole('link', { name: 'Resta attivo' }).first()).toBeVisible();
  const visitor = await newSession();
  await visitor.goto(requireValue('memberKeepUrl'));
  await expect(visitor.getByRole('heading', { name: 'Resta attivo' })).toBeVisible();
});
