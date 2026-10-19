import { createContext, useContext } from 'react';

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export const THEME_STORAGE_KEY = 'easysend-theme';

export interface ThemeContextValue {
  /** User choice, including 'system'. */
  theme: ThemePreference;
  /** Theme actually applied. */
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within ThemeProvider');
  return value;
}
