import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { readStorage, writeStorage } from '@/lib/storage';
import enAdmin from './locales/en/admin.json';
import enAuth from './locales/en/auth.json';
import enCommon from './locales/en/common.json';
import enDownload from './locales/en/download.json';
import enErrors from './locales/en/errors.json';
import enProfile from './locales/en/profile.json';
import enSetup from './locales/en/setup.json';
import enTransfers from './locales/en/transfers.json';
import itAdmin from './locales/it/admin.json';
import itAuth from './locales/it/auth.json';
import itCommon from './locales/it/common.json';
import itDownload from './locales/it/download.json';
import itErrors from './locales/it/errors.json';
import itProfile from './locales/it/profile.json';
import itSetup from './locales/it/setup.json';
import itTransfers from './locales/it/transfers.json';

export const SUPPORTED_LOCALES = ['it', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const LOCALE_STORAGE_KEY = 'easysend-locale';

/**
 * Translation namespaces. Each one is a file in `locales/<lng>/<name>.json` and is nested under
 * its name inside the single i18next `translation` resource: keys read `common.save`,
 * `auth.title`, ... with the default `t`. To add a namespace, add it here and to `resources`.
 */
export const NAMESPACES = [
  'common',
  'errors',
  'auth',
  'setup',
  'transfers',
  'download',
  'profile',
  'admin',
] as const;

export const resources = {
  it: {
    translation: {
      common: itCommon,
      errors: itErrors,
      auth: itAuth,
      setup: itSetup,
      transfers: itTransfers,
      download: itDownload,
      profile: itProfile,
      admin: itAdmin,
    },
  },
  en: {
    translation: {
      common: enCommon,
      errors: enErrors,
      auth: enAuth,
      setup: enSetup,
      transfers: enTransfers,
      download: enDownload,
      profile: enProfile,
      admin: enAdmin,
    },
  },
} as const;

export function isLocale(value: string | null | undefined): value is Locale {
  return value === 'it' || value === 'en';
}

/** Stored override, then the browser languages (it* / en*), otherwise `fallback`. */
export function detectLocale(fallback: Locale = 'en'): Locale {
  const stored = readStorage(LOCALE_STORAGE_KEY);
  if (isLocale(stored)) return stored;
  for (const language of navigator.languages ?? [navigator.language]) {
    const code = language.toLowerCase();
    if (code.startsWith('it')) return 'it';
    if (code.startsWith('en')) return 'en';
  }
  return fallback;
}

/** Applies a locale; `persist` also stores it as the visitor's explicit choice. */
export function setLocale(locale: Locale, persist = true): void {
  if (persist) writeStorage(LOCALE_STORAGE_KEY, locale);
  void i18next.changeLanguage(locale);
}

function syncHtmlLang(locale: string): void {
  document.documentElement.lang = locale;
}

void i18next.use(initReactI18next).init({
  resources,
  lng: detectLocale(),
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LOCALES,
  interpolation: { escapeValue: false },
});

syncHtmlLang(i18next.language);
i18next.on('languageChanged', syncHtmlLang);

export default i18next;
