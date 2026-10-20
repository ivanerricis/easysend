// Playwright `test` with a guard: every page of the test is watched and the test fails when the
// app logs a console error, throws an uncaught exception or triggers a CSP violation.
import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { axeActive } from './a11y.ts';

export interface Problems {
  csp: string[];
  errors: string[];
  allowed: RegExp[];
  /** Tolerates console errors that match, for tests that cause them on purpose. */
  allow: (pattern: RegExp) => void;
}

/** Expected 4xx answers (wrong password, expired link...) are logged by the browser itself. */
const EXPECTED_HTTP_ERROR = /Failed to load resource: the server responded with a status of 4\d\d/;
const AXE_EVAL = /blocked=eval|unsafe-eval/;

function guard(page: Page, problems: Problems): void {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // axe-core evaluates code strings inside the page; that is the tool, not the app.
    if (axeActive.has(page) && AXE_EVAL.test(text)) return;
    if (EXPECTED_HTTP_ERROR.test(text) || problems.allowed.some((pattern) => pattern.test(text)))
      return;
    if (text.startsWith('CSPVIOLATION ') || /Content Security Policy/i.test(text)) {
      problems.csp.push(`${page.url()} ${text}`);
    } else {
      problems.errors.push(`${page.url()} ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    problems.errors.push(`${page.url()} pageerror: ${error.message}`);
  });
}

async function instrument(context: BrowserContext, problems: Problems): Promise<void> {
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(
        `CSPVIOLATION ${event.violatedDirective} blocked=${event.blockedURI} sample=${event.sample}`,
      );
    });
  });
  context.on('page', (page) => guard(page, problems));
  for (const page of context.pages()) guard(page, problems);
}

interface Fixtures {
  problems: Problems;
  /** A new, watched browser context (own cookies) with one page; closed automatically. */
  newSession: (options?: BrowserContextOptions) => Promise<Page>;
}

export const test = base.extend<Fixtures>({
  problems: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures need the destructuring form
    async ({}, use, testInfo) => {
      const problems: Problems = {
        csp: [],
        errors: [],
        allowed: [],
        allow(pattern) {
          this.allowed.push(pattern);
        },
      };
      await use(problems);
      if (testInfo.status === 'passed' || testInfo.status === undefined) {
        expect(problems.csp, 'CSP violations').toEqual([]);
        expect(problems.errors, 'console errors and uncaught exceptions').toEqual([]);
      }
    },
    { auto: true },
  ],

  context: async ({ context, problems }, use) => {
    await instrument(context, problems);
    await use(context);
  },

  newSession: async ({ browser, problems }, use) => {
    const opened: BrowserContext[] = [];
    await use(async (options = {}) => {
      const context = await openContext(browser, problems, options);
      opened.push(context);
      return context.newPage();
    });
    for (const context of opened) await context.close();
  },
});

async function openContext(
  browser: Browser,
  problems: Problems,
  options: BrowserContextOptions,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    colorScheme: 'light',
    // A session of its own: never inherit the logged-in storageState of the test.
    storageState: { cookies: [], origins: [] },
    ...options,
  });
  await instrument(context, problems);
  return context;
}

export { expect };
