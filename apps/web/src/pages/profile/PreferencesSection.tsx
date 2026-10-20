import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useLocale } from '@/i18n/LocaleProvider';
import { useTheme } from '@/theme/theme-context';
import { Section } from './Section';

const LOCALE_OPTIONS = [
  { value: 'it', label: 'Italiano' },
  { value: 'en', label: 'English' },
] as const;

const THEME_OPTIONS = ['light', 'dark', 'system', 'instance'] as const;
type ThemeOption = (typeof THEME_OPTIONS)[number];

function Option({ id, value, children }: { id: string; value: string; children: string }) {
  return (
    <div className="flex min-h-11 items-center gap-3">
      <RadioGroupItem id={id} value={value} />
      <Label htmlFor={id} className="min-h-11 flex-1 py-3 text-sm font-normal">
        {children}
      </Label>
    </div>
  );
}

export function PreferencesSection() {
  const { t } = useTranslation();
  const { locale, changeLocale } = useLocale();
  const { theme, source, setTheme } = useTheme();
  const base = useId();
  const currentTheme: ThemeOption = source === 'instance' ? 'instance' : theme;

  return (
    <Section title={t('profile.preferences.title')}>
      <div className="space-y-1">
        <p id={`${base}-lang`} className="text-sm font-medium">
          {t('profile.preferences.language')}
        </p>
        <RadioGroup
          value={locale}
          onValueChange={(value) => changeLocale(value === 'it' ? 'it' : 'en')}
          aria-labelledby={`${base}-lang`}
        >
          {LOCALE_OPTIONS.map((option) => (
            <Option key={option.value} id={`${base}-lang-${option.value}`} value={option.value}>
              {option.label}
            </Option>
          ))}
        </RadioGroup>
      </div>
      <div className="space-y-1">
        <p id={`${base}-theme`} className="text-sm font-medium">
          {t('profile.preferences.theme')}
        </p>
        <RadioGroup
          value={currentTheme}
          onValueChange={(value) => {
            if (value === 'instance') setTheme(null);
            else if (value === 'light' || value === 'dark' || value === 'system') setTheme(value);
          }}
          aria-labelledby={`${base}-theme`}
        >
          {THEME_OPTIONS.map((option) => (
            <Option key={option} id={`${base}-theme-${option}`} value={option}>
              {t(`common.theme.${option}`)}
            </Option>
          ))}
        </RadioGroup>
        <p className="text-muted-foreground text-sm">{t('profile.preferences.themeHelp')}</p>
      </div>
    </Section>
  );
}
