// Expiry: a transfer whose `expires_at` is pushed into the past (directly in the SQLite database
// of the api container) is reported as expired to the recipient and in the owner's list.
import { checkA11y } from '../support/a11y.ts';
import { nodeInApi } from '../support/compose.ts';
import { createTestFile } from '../support/files.ts';
import { expect, test } from '../support/fixtures.ts';
import { createTransfer } from '../support/transfers.ts';
import { sessionFile } from '../support/ui.ts';

test.use({ storageState: sessionFile('admin') });

test('an expired transfer is shown as expired to the recipient and to the owner', async ({
  page,
  newSession,
  problems,
}) => {
  problems.allow(/status of 4\d\d/);
  const note = createTestFile('scadenza.txt', 1024);
  const url = await createTransfer(page, { files: [note.path], title: 'Scade presto' });

  const visitor = await newSession();
  await visitor.goto(url);
  await expect(visitor.getByRole('heading', { name: 'Scade presto' })).toBeVisible();

  const script = `
    const Database = require('better-sqlite3');
    const db = new Database('/data/db/app.sqlite');
    const past = Math.floor(Date.now() / 1000) - 3600;
    const info = db.prepare("UPDATE transfers SET expires_at = ? WHERE title = 'Scade presto'").run(past);
    console.log('changed=' + info.changes);
  `;
  const result = nodeInApi(script);
  expect(result.stdout + result.stderr).toContain('changed=1');

  await visitor.reload();
  await expect(visitor.getByRole('heading', { name: 'Trasferimento scaduto' })).toBeVisible();
  await checkA11y(visitor, 'download-expired');

  await page.goto('/transfers');
  const row = page.getByRole('row').filter({ hasText: 'Scade presto' });
  await expect(
    row.or(page.getByRole('listitem').filter({ hasText: 'Scade presto' })).first(),
  ).toContainText('Scaduto');
  await checkA11y(page, 'transfers-list-expired');
});
