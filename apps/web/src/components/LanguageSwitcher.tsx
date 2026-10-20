import { useTranslation } from 'react-i18next';
import { SelectInput } from '@/components/common/SelectInput';
import { useLocale } from '@/i18n/LocaleProvider';
import { SUPPORTED_LOCALES, type Locale } from '@/i18n';

const NAMES: Record<Locale, string> = { it: 'Italiano', en: 'English' };

const OPTIONS = SUPPORTED_LOCALES.map((option) => ({
  value: option,
  label: NAMES[option],
  lang: option,
}));

/** Language select with a visually hidden label (44px high). Saves to the profile when logged in. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { locale, changeLocale } = useLocale();

  return (
    <div className={className}>
      <label htmlFor="language-select" className="sr-only">
        {t('common.language.label')}
      </label>
      <SelectInput
        id="language-select"
        value={locale}
        options={OPTIONS}
        onValueChange={(next) => changeLocale(next === 'it' ? 'it' : 'en')}
        className="w-auto min-w-28"
      />
    </div>
  );
}
