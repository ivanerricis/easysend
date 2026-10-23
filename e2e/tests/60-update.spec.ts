// One-click update from the admin panel: the install block while the host runner is missing, the
// version picker and confirmation once it is installed, the request file the API writes, and the
// progress and outcome panels driven by status.json, which the test writes the way the host runner
// would (the stack is never restarted). The API reports 0.1.0 (see docker/docker-compose.test.yml).
import { checkA11y } from '../support/a11y.ts';
import { composeExec, nodeInApi } from '../support/compose.ts';
import { expect, test } from '../support/fixtures.ts';
import { pickOption, sessionFile } from '../support/ui.ts';

test.use({ storageState: sessionFile('admin') });
test.describe.configure({ mode: 'serial' });

const FAKE_URL = `http://127.0.0.1:${process.env.E2E_FAKE_CF_PORT ?? '18787'}`;
const CURRENT = '0.1.0';
const RELEASES = ['0.3.0', '0.2.0'].map((version, index) => ({
  tag_name: `v${version}`,
  html_url: `https://github.com/ivanerricis/easysend/releases/tag/v${version}`,
  published_at: `2026-10-${20 - index}T10:00:00Z`,
  draft: false,
  prerelease: false,
}));
const LOG_PATH = '/opt/easysend/.deploy/update.log';

async function setReleases(list: unknown[]): Promise<void> {
  const response = await fetch(`${FAKE_URL}/__fake/releases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(list),
  });
  expect(response.ok).toBe(true);
}

/** Runs a small node script as the `node` user in the api container, where /updates is writable. */
function inUpdates(body: string): void {
  const result = nodeInApi(`const fs = require('node:fs'); ${body}`);
  expect(result.status, result.stderr).toBe(0);
}

function clearUpdateDir(): void {
  inUpdates(
    `for (const f of ['runner.json', 'request', 'status.json']) fs.rmSync('/updates/' + f, { force: true });`,
  );
}

function installRunner(): void {
  inUpdates(
    `fs.writeFileSync('/updates/runner.json', JSON.stringify({ version: 1, installedAt: Math.floor(Date.now() / 1000) }));`,
  );
}

/** Writes status.json like the host runner does. */
function writeStatus(status: {
  id: string;
  targetVersion: string;
  state: 'running' | 'succeeded' | 'rolled_back' | 'failed';
  step: string;
  error?: string;
  finished?: boolean;
}): void {
  const now = Math.floor(Date.now() / 1000);
  const json = JSON.stringify({
    id: status.id,
    targetVersion: status.targetVersion,
    fromVersion: CURRENT,
    state: status.state,
    step: status.step,
    error: status.error ?? null,
    startedAt: now,
    updatedAt: now,
    finishedAt: status.finished ? now : null,
  });
  inUpdates(
    `fs.writeFileSync('/updates/status.json.tmp', ${JSON.stringify(json)}); fs.renameSync('/updates/status.json.tmp', '/updates/status.json');`,
  );
}

/** The request file the API wrote, checked against its exact format; returns its id. */
function readRequest(version: string): string {
  const result = composeExec('api', ['cat', '/updates/request']);
  expect(result.status, result.stderr).toBe(0);
  const match = /^id=([0-9a-f]{32})\nversion=(\S+)\nrequestedAt=(\d+)\n$/.exec(result.stdout);
  expect(match, `unexpected request file: ${JSON.stringify(result.stdout)}`).not.toBeNull();
  expect(match![2]).toBe(version);
  return match![1]!;
}

function removeRequest(): void {
  inUpdates(`fs.rmSync('/updates/request', { force: true });`);
}

test.beforeAll(async () => {
  clearUpdateDir();
  await setReleases(RELEASES);
});

test.afterAll(async () => {
  clearUpdateDir();
  await setReleases([]);
});

test('without the host runner the panel explains how to install it', async ({ page }) => {
  await page.goto('/admin/settings#settings-updates');
  await expect(page.getByText(CURRENT, { exact: true }).first()).toBeVisible();
  // The answer may be cached from an earlier visit with an empty list: ask again.
  await page.getByRole('button', { name: 'Controlla ora' }).click();
  await expect(page.getByText('0.3.0', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Aggiornamento disponibile' }),
  ).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Aggiornamento con un clic' })).toBeVisible();
  await expect(page.getByRole('group', { name: /installare il servizio/ })).toContainText(
    'sudo ./scripts/update-service.sh install',
  );
  await expect(page.getByRole('button', { name: 'Aggiorna ora' })).toHaveCount(0);
  await checkA11y(page, 'admin-update-runner-missing');
});

test('with the runner installed: pick a version, confirm, the request is written', async ({
  page,
}) => {
  installRunner();
  await page.goto('/admin/settings#settings-updates');
  await page.getByRole('button', { name: 'Controlla ora' }).click();

  const select = page.getByRole('combobox', { name: 'Versione da installare' });
  await expect(select).toHaveText(/0\.3\.0/);
  await expect(page.getByRole('button', { name: 'Aggiorna ora' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aggiornamento con un clic' })).toHaveCount(0);
  await checkA11y(page, 'admin-update-ready');

  await pickOption(page, select, /^0\.2\.0/);
  await expect(select).toHaveText(/0\.2\.0/);
  await page.getByRole('button', { name: 'Aggiorna ora' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(
    dialog.getByRole('heading', { name: `Aggiornare dalla ${CURRENT} alla 0.2.0?` }),
  ).toBeVisible();
  await checkA11y(page, 'admin-update-confirm');
  await dialog.getByRole('button', { name: 'Aggiorna', exact: true }).click();

  const progress = page.getByTestId('update-progress');
  await expect(progress).toBeVisible();
  await expect(progress.getByRole('heading', { name: 'Aggiornamento alla 0.2.0' })).toBeVisible();
  await expect(progress.getByText(/Passaggio 1 di 7: Richiesta inviata al server/)).toBeVisible();
  readRequest('0.2.0');
});

test('the progress follows status.json and ends with the success message', async ({ page }) => {
  await page.goto('/admin/settings#settings-updates');
  const progress = page.getByTestId('update-progress');
  await expect(progress).toBeVisible();
  const id = readRequest('0.2.0');

  // The runner takes the request over: the request file goes away, the status says "backup".
  // Status first, then the request: the API never sees a state with neither (that would end the polling).
  writeStatus({ id, targetVersion: '0.2.0', state: 'running', step: 'backup' });
  removeRequest();
  await expect(progress.getByText(/Passaggio 4 di 7: Backup del database/)).toBeVisible({
    timeout: 15_000,
  });
  await checkA11y(page, 'admin-update-running');

  writeStatus({ id, targetVersion: '0.2.0', state: 'succeeded', step: 'done', finished: true });
  await expect(page.getByText('Aggiornato alla 0.2.0')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Ricarica la pagina' })).toBeVisible();
  await expect(page.getByTestId('update-progress')).toHaveCount(0);
  await checkA11y(page, 'admin-update-succeeded');
});

test('a failed deploy that was rolled back says so and points to the log', async ({ page }) => {
  await page.goto('/admin/settings#settings-updates');
  await page.getByRole('button', { name: 'Controlla ora' }).click();
  await expect(page.getByRole('button', { name: 'Aggiorna ora' })).toBeVisible();
  await page.getByRole('button', { name: 'Aggiorna ora' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Aggiorna', exact: true })
    .click();
  const progress = page.getByTestId('update-progress');
  await expect(progress).toBeVisible();
  const version = /Aggiornamento alla (\d+\.\d+\.\d+)/.exec(
    (await progress.getByRole('heading').textContent()) ?? '',
  )![1]!;
  const id = readRequest(version);

  writeStatus({ id, targetVersion: version, state: 'running', step: 'rollback' });
  removeRequest();
  await expect(progress.getByText(/Ritorno alla versione precedente/).first()).toBeVisible({
    timeout: 15_000,
  });

  writeStatus({
    id,
    targetVersion: version,
    state: 'rolled_back',
    step: 'done',
    error: 'deploy',
    finished: true,
  });
  await expect(page.getByText(`L'aggiornamento alla ${version} è fallito`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(new RegExp(`L'istanza è tornata alla ${CURRENT}`))).toBeVisible();
  await expect(page.getByText(LOG_PATH)).toBeVisible();
  await checkA11y(page, 'admin-update-rolled-back');
});
