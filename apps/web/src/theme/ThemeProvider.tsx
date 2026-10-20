import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { useSession } from '@/app/providers/SessionProvider';
import { updateMe } from '@/lib/api/me';
import { readStorage, removeStorage, writeStorage } from '@/lib/storage';
import { notifyError } from '@/lib/toast';
import i18next from '@/i18n';
import {
  THEME_DEFAULT_STORAGE_KEY,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  ThemeContext,
  type ThemeContextValue,
  type ThemePreference,
  type ThemeSource,
} from './theme-context';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function parsePreference(value: string | null): ThemePreference | null {
  return THEME_PREFERENCES.find((candidate) => candidate === value) ?? null;
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/**
 * Resolution order: the logged-in user's `themePreference` (when not null), the visitor's
 * localStorage choice, the instance default, then the system setting.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { appearance } = useAppearance();
  const { user, setSessionUser } = useSession();
  // localStorage is read on every render; `bump` re-renders after we write to it.
  const [, bump] = useReducer((count: number) => count + 1, 0);
  const stored = parsePreference(readStorage(THEME_STORAGE_KEY));
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);
  const instanceDefault = appearance.defaultTheme;
  const userPreference = user?.themePreference ?? null;

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Cache the instance default for the anti-flash script (`public/theme-init.js`).
  useEffect(() => {
    writeStorage(THEME_DEFAULT_STORAGE_KEY, instanceDefault);
  }, [instanceDefault]);

  // Mirror the profile preference locally so the next page load paints the right theme.
  useEffect(() => {
    if (userPreference) writeStorage(THEME_STORAGE_KEY, userPreference);
  }, [userPreference]);

  let theme: ThemePreference = instanceDefault;
  let source: ThemeSource = 'instance';
  if (userPreference) {
    theme = userPreference;
    source = 'user';
  } else if (stored) {
    theme = stored;
    source = 'local';
  }

  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [resolvedTheme]);

  const setTheme = useCallback(
    (next: ThemePreference | null) => {
      if (next) writeStorage(THEME_STORAGE_KEY, next);
      else removeStorage(THEME_STORAGE_KEY);
      bump();
      if (!user) return;
      const previous = user;
      setSessionUser({ ...user, themePreference: next });
      updateMe({ themePreference: next })
        .then((result) => setSessionUser(result.user))
        .catch(() => {
          setSessionUser(previous);
          notifyError(i18next.t('common.themeSaveFailed'));
        });
    },
    [user, setSessionUser],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, instanceDefault, source, setTheme }),
    [theme, resolvedTheme, instanceDefault, source, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
