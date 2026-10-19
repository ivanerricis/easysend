import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { THEME_PREFERENCES, useTheme, type ThemePreference } from '@/theme/theme-context';

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;
const LABEL_KEYS = {
  light: 'header.themeLight',
  dark: 'header.themeDark',
  system: 'header.themeSystem',
} as const satisfies Record<ThemePreference, string>;

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <div role="group" aria-label={t('header.theme')} className="flex items-center gap-1">
      {THEME_PREFERENCES.map((option) => {
        const Icon = ICONS[option];
        const label = t(LABEL_KEYS[option]);
        return (
          <Button
            key={option}
            type="button"
            variant={theme === option ? 'default' : 'outline'}
            className="size-11"
            aria-pressed={theme === option}
            aria-label={label}
            title={label}
            onClick={() => setTheme(option)}
          >
            <Icon aria-hidden="true" className="size-5" />
          </Button>
        );
      })}
    </div>
  );
}
