import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { SUPPORTED_LOCALES, type Locale } from '@/i18n';
import { useLocale } from '@/i18n/LocaleProvider';

/** Language names in their own language: they do not change with the UI language. */
export const LOCALE_NAMES: Record<Locale, string> = { it: 'Italiano', en: 'English' };

/** Radio items (one per supported language) for a dropdown menu. */
export function LocaleRadioGroup() {
  const { locale, changeLocale } = useLocale();
  return (
    <DropdownMenuRadioGroup
      value={locale}
      onValueChange={(value) => changeLocale(value === 'it' ? 'it' : 'en')}
    >
      {SUPPORTED_LOCALES.map((option) => (
        <DropdownMenuRadioItem key={option} value={option} lang={option}>
          {LOCALE_NAMES[option]}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}
