import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { readStorage, writeStorage } from '@/lib/storage';
import en from './en.json';
import it from './it.json';

export const SUPPORTED_LOCALES = ['it', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const LOCALE_STORAGE_KEY = 'easysend-locale';

function isLocale(value: string | null): value is Locale {
  return value === 'it' || value === 'en';
}

/** Stored override first, then the browser languages (it* -> 'it'), otherwise 'en'. */
export function detectLocale(): Locale {
  const stored = readStorage(LOCALE_STORAGE_KEY);
  if (isLocale(stored)) return stored;
  const first = navigator.languages[0] ?? navigator.language;
  return first.toLowerCase().startsWith('it') ? 'it' : 'en';
}

/** Explicit user choice: persisted and applied. */
export function setLocale(locale: Locale): void {
  writeStorage(LOCALE_STORAGE_KEY, locale);
  void i18next.changeLanguage(locale);
}

function syncHtmlLang(locale: string): void {
  document.documentElement.lang = locale;
}

void i18next.use(initReactI18next).init({
  resources: { it: { translation: it }, en: { translation: en } },
  lng: detectLocale(),
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LOCALES,
  interpolation: { escapeValue: false },
});

syncHtmlLang(i18next.language);
i18next.on('languageChanged', syncHtmlLang);

export default i18next;
