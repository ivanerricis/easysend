import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES, setLocale, type Locale } from '@/i18n';

const NAMES: Record<Locale, string> = { it: 'Italiano', en: 'English' };

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current: Locale = i18n.language.startsWith('it') ? 'it' : 'en';

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="language-select" className="text-sm font-medium">
        {t('header.language')}
      </label>
      <select
        id="language-select"
        value={current}
        onChange={(event) => setLocale(event.target.value === 'it' ? 'it' : 'en')}
        className="border-input bg-background text-foreground h-11 min-w-28 border px-3 text-sm"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale} lang={locale}>
            {NAMES[locale]}
          </option>
        ))}
      </select>
    </div>
  );
}
