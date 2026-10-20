// First-run wizard on a fresh production stack: setup code (wrong, then right), admin with 2FA and
// recovery codes, SMTP (Mailpit) with a real test email, Cloudflare against the fake API (rejected
// token, then success), general settings with 1 MB upload chunks, finish.
import { checkA11y } from '../support/a11y.ts';
import { composeExec, readSetupCode } from '../support/compose.ts';
import { expect, test } from '../support/fixtures.ts';
import { fakeCloudflareUrl } from '../support/paths.ts';
import { deleteAllMessages, waitForMessage } from '../support/mailpit.ts';
import { updateState } from '../support/state.ts';
import { nextTotp } from '../support/totp.ts';
import { saveSession } from '../support/ui.ts';

const ADMIN = {
  email: 'admin@example.com',
  displayName: 'Giulia Rossi',
  password: 'Correct-Horse-Battery-42',
};
const CF_TOKEN = 'fake-cloudflare-token-0123456789';

test.describe.configure({ mode: 'serial' });

async function fakeCf(path: string, body?: unknown) {
  const response = await fetch(`${fakeCloudflareUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

test('setup wizard in production mode', async ({ page }) => {
  await fakeCf('/__fake/reset', {});
  await deleteAllMessages();

  // ---------------------------------------------------------------- setup code
  await page.goto('/setup');
  await expect(page.getByLabel('Codice di configurazione')).toBeVisible();
  await checkA11y(page, 'setup-code');
  await page.getByLabel('Codice di configurazione').fill('AAAA-AAAA-AAAA');
  await page.getByRole('button', { name: 'Continua' }).click();
  await expect(page.getByText('Il codice non è corretto').first()).toBeVisible();

  await page.getByLabel('Codice di configurazione').fill(await readSetupCode());
  await page.getByRole('button', { name: 'Continua' }).click();

  // ---------------------------------------------------------------- admin + 2FA
  await expect(page.getByRole('heading', { name: "Crea l'account amministratore" })).toBeVisible();
  await checkA11y(page, 'setup-admin');
  await page.getByLabel('Email', { exact: true }).fill(ADMIN.email);
  await page.getByLabel('Nome visualizzato').fill(ADMIN.displayName);
  await page.getByLabel(/^Password/).fill(ADMIN.password);
  await page.getByLabel('Conferma password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Continua' }).click();

  const secretBox = page.locator('code[aria-labelledby]');
  await expect(secretBox).toBeVisible();
  const secret = ((await secretBox.textContent()) ?? '').replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  await checkA11y(page, 'setup-2fa');
  await page
    .getByLabel(/Inserisci il codice a 6 cifre/)
    .first()
    .fill(await nextTotp(secret));

  await expect(
    page.getByRole('heading', { name: 'Codici di recupero', exact: true }),
  ).toBeVisible();
  const recoveryCodes = (await page.locator('ul.font-mono li').allTextContents()).map((c) =>
    c.trim(),
  );
  expect(recoveryCodes).toHaveLength(10);
  for (const code of recoveryCodes) expect(code).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i);
  updateState((state) => {
    state.admin = { ...ADMIN, totpSecret: secret, recoveryCodes };
  });
  await checkA11y(page, 'setup-recovery-codes');
  await page.getByLabel('Ho salvato i codici di recupero in un posto sicuro').check();
  await page.getByRole('button', { name: 'Continua' }).click();

  // ---------------------------------------------------------------- SMTP (Mailpit, filled by hand)
  await expect(page.getByRole('heading', { name: 'Server email' })).toBeVisible();
  await page.getByLabel('Server', { exact: true }).fill('mailpit');
  await page.getByRole('textbox', { name: 'Porta' }).fill('1025');
  await page.getByRole('radio', { name: /^Nessuna/ }).click();
  await page.getByLabel('Email del mittente').fill('noreply@easysend.test');
  await page.getByLabel('Nome del mittente').fill('EasySend E2E');
  await expect(page.getByRole('button', { name: 'Salva e continua' })).toBeDisabled();
  await page.getByRole('button', { name: 'Invia email di prova' }).click();
  await expect(page.getByText('Email di prova inviata').first()).toBeVisible();
  const testMail = await waitForMessage(ADMIN.email, /email di prova|test email/i);
  expect(testMail.From.Address).toBe('noreply@easysend.test');
  await checkA11y(page, 'setup-smtp');
  await page.getByRole('button', { name: 'Salva e continua' }).click();

  // ---------------------------------------------------------------- Cloudflare (fake API)
  await expect(page.getByRole('heading', { name: 'Dominio e tunnel Cloudflare' })).toBeVisible();
  await page.getByLabel('Dominio', { exact: true }).fill('example.com');
  await page.getByLabel('Sottodominio').fill('files');
  await page.getByLabel('Token API di Cloudflare').fill(CF_TOKEN);
  await fakeCf('/__fake/fail', { invalidToken: true });
  await page.getByRole('button', { name: 'Crea il tunnel' }).click();
  await expect(page.getByText('Controlla che il token sia attivo')).toBeVisible();
  await checkA11y(page, 'setup-cloudflare-error');
  const failed = (await fakeCf('/__fake/state')) as { tunnels: unknown[]; records: unknown[] };
  expect(failed.tunnels).toEqual([]);
  expect(failed.records).toEqual([]);

  await fakeCf('/__fake/fail', { invalidToken: false });
  await page.getByRole('button', { name: 'Riprova' }).click();
  await expect(page.getByRole('heading', { name: 'Tunnel creato' })).toBeVisible();
  await expect(page.getByText('https://files.example.com')).toBeVisible();
  await checkA11y(page, 'setup-cloudflare-done');

  const state = (await fakeCf('/__fake/state')) as {
    tunnels: {
      name: string;
      deleted_at: string | null;
      ingress?: { hostname?: string; service: string }[];
    }[];
    records: { type: string; name: string; proxied?: boolean; content: string }[];
    requests: { hasAuthorization: boolean }[];
  };
  const tunnels = state.tunnels.filter((tunnel) => !tunnel.deleted_at);
  expect(tunnels).toHaveLength(1);
  expect(tunnels[0]?.name).toMatch(/^easysend-/);
  expect(tunnels[0]?.ingress).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ hostname: 'files.example.com', service: 'http://web:8080' }),
    ]),
  );
  expect(state.records).toEqual([
    expect.objectContaining({ type: 'CNAME', name: 'files.example.com', proxied: true }),
  ]);
  expect(state.requests.every((request) => request.hasAuthorization)).toBe(true);
  // The tunnel token is handed to cloudflared through the shared volume, never stored elsewhere.
  expect(composeExec('api', ['test', '-s', '/shared/tunnel-token']).status).toBe(0);
  await page.getByRole('button', { name: 'Continua' }).click();

  // ---------------------------------------------------------------- general settings
  await expect(page.getByRole('heading', { name: 'Impostazioni generali' })).toBeVisible();
  await page.getByLabel(/^Dimensione dei blocchi di caricamento/).fill('1');
  await checkA11y(page, 'setup-general');
  await page.getByRole('button', { name: 'Continua' }).click();

  // ---------------------------------------------------------------- finish
  await expect(page.getByRole('heading', { name: 'Pronto per concludere' })).toBeVisible();
  await checkA11y(page, 'setup-complete');
  await page.getByRole('button', { name: 'Concludi la configurazione' }).click();
  await expect(page.getByRole('heading', { name: 'Invia file' })).toBeVisible();
  await saveSession(page, 'admin');

  // The wizard is locked for good once it is done.
  const status = await page.request.get('/api/setup/status');
  expect(await status.json()).toMatchObject({ setupCompleted: true, appMode: 'production' });
});
