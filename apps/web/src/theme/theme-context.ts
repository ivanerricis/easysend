import { createContext, useContext } from 'react';

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
/** localStorage key of the visitor's own choice. */
export const THEME_STORAGE_KEY = 'easysend-theme';
/** localStorage cache of the instance default (read by `public/theme-init.js`). */
export const THEME_DEFAULT_STORAGE_KEY = 'easysend-theme-default';

/** Where the effective theme comes from, in priority order. */
export type ThemeSource = 'user' | 'local' | 'instance';

export interface ThemeContextValue {
  /** Effective preference, including 'system'. */
  theme: ThemePreference;
  /** Theme actually applied. */
  resolvedTheme: 'light' | 'dark';
  /** Instance default (`appearance.defaultTheme`). */
  instanceDefault: ThemePreference;
  /** Which level decided `theme`; 'instance' means "following the instance default". */
  source: ThemeSource;
  /**
   * Explicit choice: persisted locally and, when logged in, saved to the profile.
   * `null` means "use the instance default" (clears both).
   */
  setTheme: (theme: ThemePreference | null) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within ThemeProvider');
  return value;
}
