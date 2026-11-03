import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/theme/theme-context';
import { ThemeRadioGroup } from './ThemeRadioGroup';

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/** Compact theme menu for public pages: a 44px button that opens light / dark / system / default. */
export function ThemeSwitcher() {
  const { t } = useTranslation();
  const { theme } = useTheme();
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
        <ThemeRadioGroup />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
