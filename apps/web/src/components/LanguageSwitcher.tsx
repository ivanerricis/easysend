import { useTranslation } from 'react-i18next';
import { useLocale } from '@/i18n/LocaleProvider';
import { SUPPORTED_LOCALES, type Locale } from '@/i18n';

const NAMES: Record<Locale, string> = { it: 'Italiano', en: 'English' };

/** Language select with a visually hidden label (44px high). Saves to the profile when logged in. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { locale, changeLocale } = useLocale();

  return (
    <div className={className}>
      <label htmlFor="language-select" className="sr-only">
        {t('common.language.label')}
      </label>
      <select
        id="language-select"
        value={locale}
        onChange={(event) => changeLocale(event.target.value === 'it' ? 'it' : 'en')}
        className="border-input bg-background text-foreground h-11 min-w-24 border px-2 text-sm"
      >
        {SUPPORTED_LOCALES.map((option) => (
          <option key={option} value={option} lang={option}>
            {NAMES[option]}
          </option>
        ))}
      </select>
    </div>
  );
}
