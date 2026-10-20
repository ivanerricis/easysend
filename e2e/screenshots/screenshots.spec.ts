// Screenshots + accessibility run (see scripts/screenshots.mjs). One serial test drives the whole
// app on a fresh stack: setup wizard, admin, transfer, public download. Every page is captured in
// light and dark and checked with axe-core; serious/critical violations and CSP violations fail it.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as OTPAuth from 'otpauth';

const root = process.env.E2E_REPO_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'screenshots');
const composeArgs = JSON.parse(process.env.E2E_COMPOSE_ARGS ?? '[]') as string[];

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_NAME = 'Giulia Rossi';
const ADMIN_PASSWORD = 'Correct-Horse-Battery-42';
const USER_EMAIL = 'marco@example.com';
const USER_PASSWORD = 'Another-Strong-Passphrase-7';
const LINK_PASSWORD = 'segreta-12345';

type Theme = 'light' | 'dark';
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 812 };

interface Finding {
  shot: string;
  id: string;
  impact: string;
  help: string;
  targets: string[];
}
const findings: Finding[] = [];
const cspViolations: string[] = [];
const consoleErrors: string[] = [];
let axeRuns = 0;
let axeActive = false;
let axeEvalIgnored = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Records console errors and CSP violations of a page. */
function track(page: Page): void {
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() !== 'error') return;
    // axe-core evaluates code strings inside the page; that is the tool, not the app.
    if (axeActive && /blocked=eval|unsafe-eval/.test(text)) {
      axeEvalIgnored += 1;
      return;
    }
    if (text.startsWith('CSPVIOLATION ') || /Content Security Policy/i.test(text)) {
      cspViolations.push(`${page.url()} ${text}`);
    } else {
      consoleErrors.push(`${page.url()} ${text}`);
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(`${page.url()} pageerror: ${error.message}`));
}

async function newContext(
  browser: Browser,
  options: { viewport?: { width: number; height: number }; storageState?: unknown } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: options.viewport ?? DESKTOP,
    colorScheme: 'light',
    ...(options.storageState ? { storageState: options.storageState as never } : {}),
  });
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(
        `CSPVIOLATION ${event.violatedDirective} blocked=${event.blockedURI} sample=${event.sample}`,
      );
    });
  });
  const page = await context.newPage();
  track(page);
  return { context, page };
}

async function applyTheme(page: Page, theme: Theme): Promise<void> {
  // The app follows the system setting by default, so emulating it exercises the real code path
  // (ThemeProvider, theme-dependent logo) instead of toggling a class by hand.
  await page.emulateMedia({ colorScheme: theme });
  await page.waitForTimeout(500);
}

async function runAxe(page: Page, shot: string): Promise<void> {
  axeActive = true;
  axeRuns += 1;
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  await sleep(300);
  axeActive = false;
  for (const violation of result.violations) {
    findings.push({
      shot,
      id: violation.id,
      impact: violation.impact ?? 'unknown',
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.join(' ')).slice(0, 6),
    });
  }
}

interface CaptureOptions {
  /** Capture the whole page height instead of the viewport only. */
  full?: boolean;
  /** Themes to capture (default: both). */
  themes?: Theme[];
}

/**
 * Resizes the viewport to the page height (instead of Playwright's `fullPage`, which stitches
 * fixed elements such as the sidebar at the wrong place) and returns the original size.
 */
async function fitViewportToContent(page: Page): Promise<() => Promise<void>> {
  const original = page.viewportSize() ?? DESKTOP;
  await page.setViewportSize({ width: original.width, height: original.height });
  const height = await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  );
  await page.setViewportSize({ width: original.width, height: Math.min(height, 4000) });
  await page.waitForTimeout(300);
  return () => page.setViewportSize(original);
}

/** Screenshots the current page in each theme (docs/screenshots/<name>-<theme>.png) plus axe. */
async function capture(page: Page, name: string, options: CaptureOptions = {}): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const restore = options.full ? await fitViewportToContent(page) : null;
  for (const theme of options.themes ?? ['light', 'dark']) {
    await applyTheme(page, theme);
    const shot = `${name}-${theme}`;
    await page.screenshot({
      path: join(outDir, `${shot}.png`),
      animations: 'disabled',
      caret: 'hide',
    });
    await runAxe(page, shot);
  }
  await applyTheme(page, 'light');
  await restore?.();
}

/** TOTP codes for one secret; never returns the same 30 s window twice (server anti-replay). */
function totpSource(secret: string): () => Promise<string> {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  let last = -1;
  return async () => {
    for (;;) {
      const counter = Math.floor(Date.now() / 30_000);
      if (counter > last) {
        last = counter;
        return totp.generate();
      }
      await sleep(1000);
    }
  };
}

/** The setup code is printed by the API in its logs (warn line "Setup code: XXXX-XXXX-XXXX"). */
async function readSetupCode(): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync('docker', [...composeArgs, 'logs', 'api', '--no-color'], {
      cwd: root,
      encoding: 'utf8',
    });
    const text = `${result.stdout}${result.stderr}`;
    const matches = [...text.matchAll(/Setup code: ([A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4})/g)];
    const last = matches.at(-1);
    if (last?.[1]) return last[1];
    await sleep(1000);
  }
  throw new Error('Setup code not found in the api logs');
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
}

test.describe.configure({ mode: 'serial' });

test('screenshots and accessibility', async ({ browser }) => {
  // ---------------------------------------------------------------- setup wizard
  const wizard = await newContext(browser);
  const w = wizard.page;
  await w.goto('/setup');
  await expect(w.getByLabel('Codice di configurazione')).toBeVisible();
  await settle(w);
  await capture(w, '01-setup-code');

  await w.getByLabel('Codice di configurazione').fill(await readSetupCode());
  await w.getByRole('button', { name: 'Continua' }).click();

  await w.getByLabel('Email', { exact: true }).fill(ADMIN_EMAIL);
  await w.getByLabel('Nome visualizzato').fill(ADMIN_NAME);
  await w.getByLabel(/^Password/).fill(ADMIN_PASSWORD);
  await w.getByLabel('Conferma password').fill(ADMIN_PASSWORD);
  await w.getByRole('button', { name: 'Continua' }).click();

  const secretBox = w.locator('code[aria-labelledby]');
  await expect(secretBox).toBeVisible();
  const secret = ((await secretBox.textContent()) ?? '').replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  await settle(w);
  await capture(w, '02-setup-admin-qr', { themes: ['light'] });
  const nextAdminCode = totpSource(secret);
  await w
    .getByLabel(/Inserisci il codice a 6 cifre/)
    .first()
    .fill(await nextAdminCode());

  await w.getByLabel('Ho salvato i codici di recupero in un posto sicuro').check();
  await w.getByRole('button', { name: 'Continua' }).click();

  await w.getByRole('button', { name: 'Invia email di prova' }).click();
  await expect(w.getByText('Email di prova inviata').first()).toBeVisible();
  await capture(w, '03-setup-smtp', { themes: ['light'] });
  await w.getByRole('button', { name: 'Salva e continua' }).click();

  // Cloudflare is skipped in local mode.
  await expect(w.getByText('Saltato in modalità locale')).toBeVisible();
  await w.getByRole('button', { name: 'Continua' }).click();
  await expect(w.getByLabel("Nome dell'istanza")).toBeVisible();
  await w.getByRole('button', { name: 'Continua' }).click();
  await w.getByRole('button', { name: 'Concludi la configurazione' }).click();
  await expect(w.getByRole('navigation').first()).toBeVisible();

  // ---------------------------------------------------------------- admin creates a user
  await w.goto('/admin/users');
  await w.getByRole('button', { name: 'Nuovo utente' }).click();
  const dialog = w.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill(USER_EMAIL);
  await dialog.getByLabel('Nome visualizzato').fill('Marco Bianchi');
  await dialog.getByLabel(/^Password/).fill(USER_PASSWORD);
  await dialog.getByRole('button', { name: 'Crea', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(w.getByText(USER_EMAIL).first()).toBeVisible();
  await wizard.context.close();

  // ---------------------------------------------------------------- login + 2FA
  const admin = await newContext(browser);
  const a = admin.page;
  await a.goto('/login');
  await expect(a.getByRole('heading', { name: 'Accedi' })).toBeVisible();
  await settle(a);
  await capture(a, '04-login');
  await a.getByLabel('Email', { exact: true }).fill(ADMIN_EMAIL);
  await a.getByLabel(/^Password/).fill(ADMIN_PASSWORD);
  await a.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(a.getByRole('heading', { name: 'Verifica in due passaggi' })).toBeVisible();
  await capture(a, '05-login-2fa');
  const code = await nextAdminCode();
  await a.getByLabel('Codice di autenticazione').first().fill(code);
  await expect(a.getByRole('heading', { name: 'Invia file' })).toBeVisible();

  // ---------------------------------------------------------------- new transfer
  await settle(a);
  await a.getByTestId('file-input').setInputFiles([
    {
      name: 'relazione-annuale.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(180_000, 7),
    },
    { name: 'foto-vacanza.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(420_000, 3) },
    { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('Ciao, ecco i file.\n') },
  ]);
  await expect(a.getByText('relazione-annuale.pdf').first()).toBeVisible();
  await a.getByLabel('Titolo').fill('Documenti della vacanza');
  await a
    .getByLabel('Messaggio')
    .fill('Ciao! Qui ci sono i file di cui parlavamo. Scrivimi se manca qualcosa.');
  await a.getByLabel(/^Password/).fill(LINK_PASSWORD);
  await a.getByLabel('Limite di download').fill('5');
  await capture(a, '06-new-transfer', { full: true });

  await a.getByRole('button', { name: 'Crea link' }).click();
  await expect(a.getByRole('heading', { name: 'Il tuo trasferimento è pronto' })).toBeVisible({
    timeout: 90_000,
  });
  const shareUrl = await a.locator('#share-url').inputValue();
  expect(shareUrl).toContain('/d/');
  await settle(a);
  await a.waitForTimeout(1500);
  await capture(a, '07-upload-success', { full: true });

  // ---------------------------------------------------------------- transfer list + detail
  await a.goto('/transfers');
  await expect(a.getByText('Documenti della vacanza').first()).toBeVisible();
  await settle(a);
  await capture(a, '08-transfers');
  await a.getByRole('link', { name: 'Documenti della vacanza' }).first().click();
  await expect(a.getByRole('heading', { name: 'Documenti della vacanza' }).first()).toBeVisible();
  await settle(a);
  await capture(a, '09-transfer-detail', { full: true });

  // ---------------------------------------------------------------- public download
  const visitor = await newContext(browser);
  const v = visitor.page;
  await v.goto(shareUrl);
  await expect(v.getByText('Questo trasferimento è protetto')).toBeVisible();
  await settle(v);
  await capture(v, '10-download-locked');
  await v.getByLabel(/^Password/).fill(LINK_PASSWORD);
  await v.getByRole('button', { name: 'Sblocca' }).click();
  await expect(v.getByText('relazione-annuale.pdf').first()).toBeVisible();
  await settle(v);
  await capture(v, '11-download-unlocked', { full: true });
  await visitor.context.close();

  // ---------------------------------------------------------------- profile + admin
  for (const [path, name, heading, full] of [
    ['/profile', '12-profile', 'Profilo', true],
    ['/admin/users', '13-admin-users', 'Utenti', false],
    ['/admin/storage', '14-admin-storage', 'Spazio', true],
    ['/admin/settings', '15-admin-settings', 'Impostazioni', true],
    ['/admin/appearance', '16-admin-appearance', 'Aspetto', true],
  ] as const) {
    await a.goto(path);
    await expect(a.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    await settle(a);
    await capture(a, name, { full });
  }

  // ---------------------------------------------------------------- mobile (375x812)
  const storageState = await admin.context.storageState();
  const guest = await newContext(browser, { viewport: MOBILE });
  await guest.page.goto('/login');
  await expect(guest.page.getByRole('heading', { name: 'Accedi' })).toBeVisible();
  await settle(guest.page);
  await capture(guest.page, '17-login-mobile');

  await guest.page.goto(shareUrl);
  await guest.page.getByLabel(/^Password/).fill(LINK_PASSWORD);
  await guest.page.getByRole('button', { name: 'Sblocca' }).click();
  await expect(guest.page.getByText('relazione-annuale.pdf').first()).toBeVisible();
  await settle(guest.page);
  await capture(guest.page, '19-download-unlocked-mobile', { full: true });
  await guest.context.close();

  const phone = await newContext(browser, { viewport: MOBILE, storageState });
  await phone.page.goto('/');
  await expect(phone.page.getByRole('heading', { name: 'Invia file' })).toBeVisible();
  await phone.page
    .getByTestId('file-input')
    .setInputFiles([
      { name: 'relazione-annuale.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(1000, 7) },
    ]);
  await expect(phone.page.getByText('relazione-annuale.pdf').first()).toBeVisible();
  await settle(phone.page);
  await capture(phone.page, '18-new-transfer-mobile', { full: true });
  await phone.context.close();
  await admin.context.close();

  // ---------------------------------------------------------------- report
  console.log(
    `
axe runs: ${axeRuns}, violations: ${findings.length}, axe-core eval reports ignored: ${axeEvalIgnored}`,
  );
  if (consoleErrors.length > 0) {
    console.log(`\nConsole errors (${consoleErrors.length}):`);
    for (const line of new Set(consoleErrors)) console.log(`  ${line}`);
  }
  const blocking = findings.filter((f) => f.impact === 'serious' || f.impact === 'critical');
  const minor = findings.filter((f) => !blocking.includes(f));
  const print = (f: Finding) =>
    console.log(`  [${f.impact}] ${f.shot}: ${f.id} - ${f.help}\n    ${f.targets.join(' | ')}`);
  if (minor.length > 0) {
    console.log(`\nAxe, minor/moderate (${minor.length}):`);
    minor.forEach(print);
  }
  if (blocking.length > 0) {
    console.log(`\nAxe, serious/critical (${blocking.length}):`);
    blocking.forEach(print);
  }
  if (cspViolations.length > 0) {
    console.log(`\nCSP violations (${cspViolations.length}):`);
    for (const line of cspViolations) console.log(`  ${line}`);
  }
  expect(cspViolations, 'CSP violations').toEqual([]);
  expect(
    blocking.map((f) => `${f.shot}: ${f.id}`),
    'serious/critical axe violations',
  ).toEqual([]);
});
