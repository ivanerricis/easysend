import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme, type ThemePreference } from '@/theme/theme-context';

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/** Value of the radio group: a theme, or 'instance' when following the instance default. */
export type ThemeChoice = ThemePreference | 'instance';

/** Compact theme menu for public pages: a 44px button that opens light / dark / system / default. */
export function ThemeSwitcher() {
  const { t } = useTranslation();
  const { theme, source, setTheme } = useTheme();
  const current: ThemeChoice = source === 'instance' ? 'instance' : theme;
  const Icon = ICONS[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`${t('common.theme.label')}: ${t(`common.theme.${theme}`)}`}
        >
          <Icon aria-hidden="true" className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) =>
            setTheme(value === 'instance' ? null : (value as ThemePreference))
          }
        >
          <DropdownMenuRadioItem value="light">{t('common.theme.light')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t('common.theme.dark')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">{t('common.theme.system')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="instance">
            {t('common.theme.instance')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
