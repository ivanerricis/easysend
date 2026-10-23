import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { sleep } from './paths.ts';

/** Pages being analysed right now: axe-core evaluates strings in the page, which the CSP reports. */
export const axeActive = new WeakSet<Page>();

export interface A11yFinding {
  id: string;
  impact: string;
  help: string;
  targets: string[];
}

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Runs axe-core (WCAG 2.2 AA) on the page and returns every violation. */
export async function analyzeA11y(page: Page): Promise<A11yFinding[]> {
  axeActive.add(page);
  try {
    const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    // CSP reports for axe's own eval arrive a little later.
    await sleep(300);
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? 'unknown',
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.join(' ')).slice(0, 6),
    }));
  } finally {
    axeActive.delete(page);
  }
}

/**
 * Accessibility check of the page's current state: attaches the full result to the report and
 * fails on serious or critical violations (minor ones are only attached).
 */
export async function checkA11y(page: Page, label: string): Promise<A11yFinding[]> {
  await page.waitForLoadState('networkidle');
  // Elements fading in (toasts, dialogs) have a partial opacity that axe reads as low contrast:
  // analyse the settled state. Infinite animations (spinners) are ignored.
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every(
            (a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity,
          ),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
  const findings = await analyzeA11y(page);
  if (findings.length > 0) {
    await test.info().attach(`axe-${label}`, {
      body: JSON.stringify(findings, null, 2),
      contentType: 'application/json',
    });
  }
  // Chrome flags form fields with neither id nor name (autofill cannot identify them).
  const unnamedFields = await page
    .locator('input, select, textarea')
    .evaluateAll((elements) =>
      elements
        .filter((el) => !el.id && !el.getAttribute('name'))
        .map((el) => el.outerHTML.slice(0, 160)),
    );
  expect.soft(unnamedFields, `form fields without id or name on "${label}"`).toEqual([]);
  const blocking = findings.filter((f) => f.impact === 'serious' || f.impact === 'critical');
  expect(
    blocking.map((f) => `[${f.impact}] ${label}: ${f.id} - ${f.help} (${f.targets.join(' | ')})`),
    `serious/critical axe violations on "${label}"`,
  ).toEqual([]);
  return findings;
}
