import {
  DEFAULT_APPEARANCE,
  contrastRatio,
  readableTextColor,
  type Appearance,
} from '@easysend/shared';

export type ResolvedTheme = 'light' | 'dark';

/**
 * Surface a custom colour must stand out from in the dark theme (zinc-900, the `--card` /
 * `--sidebar` token; the page background `#09090b` is darker, so this is the stricter bound).
 */
export const DARK_SURFACE = '#18181b';
/** Light theme surface. */
export const LIGHT_SURFACE = '#ffffff';
/** WCAG 1.4.11 non-text contrast, used for UI components in both themes. */
export const UI_CONTRAST = 3;
/** WCAG 1.4.3 text contrast. */
export const TEXT_CONTRAST = 4.5;

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * CSS custom properties that apply an instance appearance on top of the built-in tokens.
 * The default appearance returns `{}`, so the AA-verified tokens of `index.css` stay in charge.
 * In the dark theme a custom colour is used only when it keeps at least 3:1 against
 * `DARK_SURFACE`; otherwise the default dark token stays.
 *
 * Variable `--app-font-sans` (not `--font-sans`) carries the font: Tailwind inlines the theme
 * values, so `index.css` maps `--font-sans` to it.
 */
export function appearanceCssVars(
  appearance: Pick<Appearance, 'primaryColor' | 'accentColor' | 'radius' | 'font'>,
  theme: ResolvedTheme,
): Record<string, string> {
  const vars: Record<string, string> = {};
  const usable = (color: string): boolean =>
    theme === 'light' || contrastRatio(color, DARK_SURFACE) >= UI_CONTRAST;

  const { primaryColor, accentColor } = appearance;
  if (!same(primaryColor, DEFAULT_APPEARANCE.primaryColor) && usable(primaryColor)) {
    const text = readableTextColor(primaryColor);
    vars['--primary'] = primaryColor;
    vars['--primary-foreground'] = text;
    vars['--sidebar-primary'] = primaryColor;
    vars['--sidebar-primary-foreground'] = text;
  }
  if (!same(accentColor, DEFAULT_APPEARANCE.accentColor) && usable(accentColor)) {
    const text = readableTextColor(accentColor);
    vars['--accent'] = accentColor;
    vars['--accent-foreground'] = text;
    vars['--ring'] = accentColor;
    vars['--sidebar-accent'] = accentColor;
    vars['--sidebar-accent-foreground'] = text;
    vars['--sidebar-ring'] = accentColor;
    vars['--chart-1'] = accentColor;
  }
  if (appearance.radius !== DEFAULT_APPEARANCE.radius) {
    vars['--radius'] = `${appearance.radius}rem`;
  }
  if (appearance.font === 'system') {
    vars['--app-font-sans'] = 'ui-sans-serif, system-ui, sans-serif';
  }
  return vars;
}

export type ContrastCheckId =
  | 'primaryText'
  | 'primaryOnLight'
  | 'accentText'
  | 'accentOnLight'
  | 'accentAsText'
  | 'darkPrimaryFallback'
  | 'darkAccentFallback';

export interface ContrastWarning {
  id: ContrastCheckId;
  /** Measured ratio. */
  ratio: number;
  /** Ratio the check requires. */
  required: number;
}

/**
 * WCAG AA checks for the chosen colours; returns only the failing ones (UI maps `id` to text).
 * - `primaryText`: automatic text colour on the primary background (4.5).
 * - `primaryOnLight` / `accentOnLight`: colour against a white surface as a UI component (3).
 * - `accentText`: automatic text colour on the accent background (4.5).
 * - `accentAsText`: accent used as link / text colour on white (4.5).
 * - `darkPrimaryFallback` / `darkAccentFallback`: below 3:1 on the dark surface, so the dark
 *   theme keeps the default colour (informational, not an accessibility failure).
 */
export function contrastWarnings(
  appearance: Pick<Appearance, 'primaryColor' | 'accentColor'>,
): ContrastWarning[] {
  const { primaryColor, accentColor } = appearance;
  const checks: [ContrastCheckId, number, number][] = [
    ['primaryText', contrastRatio(primaryColor, readableTextColor(primaryColor)), TEXT_CONTRAST],
    ['primaryOnLight', contrastRatio(primaryColor, LIGHT_SURFACE), UI_CONTRAST],
    ['accentText', contrastRatio(accentColor, readableTextColor(accentColor)), TEXT_CONTRAST],
    ['accentOnLight', contrastRatio(accentColor, LIGHT_SURFACE), UI_CONTRAST],
    ['accentAsText', contrastRatio(accentColor, LIGHT_SURFACE), TEXT_CONTRAST],
  ];
  // The defaults have their own dark tokens, so the fallback only concerns custom colours.
  if (!same(primaryColor, DEFAULT_APPEARANCE.primaryColor)) {
    checks.push(['darkPrimaryFallback', contrastRatio(primaryColor, DARK_SURFACE), UI_CONTRAST]);
  }
  if (!same(accentColor, DEFAULT_APPEARANCE.accentColor)) {
    checks.push(['darkAccentFallback', contrastRatio(accentColor, DARK_SURFACE), UI_CONTRAST]);
  }
  return checks
    .filter(([, ratio, required]) => ratio < required)
    .map(([id, ratio, required]) => ({ id, ratio, required }));
}

/**
 * Writes `vars` on `element` and removes the properties of `previousKeys` that are no longer
 * set. Returns the keys now applied (pass them back as `previousKeys` next time). Uses CSSOM
 * calls only, which the CSP allows.
 */
export function applyCssVars(
  element: HTMLElement,
  vars: Record<string, string>,
  previousKeys: readonly string[] = [],
): string[] {
  for (const key of previousKeys) {
    if (!(key in vars)) element.style.removeProperty(key);
  }
  for (const [key, value] of Object.entries(vars)) element.style.setProperty(key, value);
  return Object.keys(vars);
}
