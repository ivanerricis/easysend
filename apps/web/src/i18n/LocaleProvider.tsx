import { useTranslation } from 'react-i18next';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { useSession } from '@/app/providers/SessionProvider';
import { updateMe } from '@/lib/api/me';
import { readStorage, writeStorage } from '@/lib/storage';
import { notifyError } from '@/lib/toast';
import i18next, { LOCALE_STORAGE_KEY, detectLocale, isLocale, setLocale, type Locale } from '.';

interface LocaleContextValue {
  /** Active language. */
  locale: Locale;
  /** Explicit choice: persisted locally and, when logged in, saved to the profile. */
  changeLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Language resolution: the logged-in user's `locale`, then the stored choice, then the browser
 * (it* / en*), then the instance `defaultLocale`.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const { defaultLocale } = useAppearance();
  const { user, setSessionUser } = useSession();
  const userLocale = user?.locale;

  useEffect(() => {
    if (userLocale) {
      writeStorage(LOCALE_STORAGE_KEY, userLocale);
      setLocale(userLocale, false);
    } else if (!isLocale(readStorage(LOCALE_STORAGE_KEY))) {
      setLocale(detectLocale(defaultLocale), false);
    }
  }, [userLocale, defaultLocale]);

  const changeLocale = useCallback(
    (next: Locale) => {
      setLocale(next);
      if (!user) return;
      const previous = user;
      setSessionUser({ ...user, locale: next });
      updateMe({ locale: next })
        .then((result) => setSessionUser(result.user))
        .catch(() => {
          setSessionUser(previous);
          notifyError(i18next.t('common.languageSaveFailed'));
        });
    },
    [user, setSessionUser],
  );

  const locale: Locale = i18n.language.startsWith('it') ? 'it' : 'en';
  const value = useMemo(() => ({ locale, changeLocale }), [locale, changeLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used within LocaleProvider');
  return value;
}
