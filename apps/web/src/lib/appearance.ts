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
const DARK_SURFACE = '#18181b';
/** WCAG 1.4.11 non-text contrast, used for UI components in both themes. */
const UI_CONTRAST = 3;

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
  if (appearance.font === 'ibm-plex-sans') {
    vars['--app-font-sans'] = "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif";
  } else if (appearance.font === 'system') {
    vars['--app-font-sans'] = 'ui-sans-serif, system-ui, sans-serif';
  }
  return vars;
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
