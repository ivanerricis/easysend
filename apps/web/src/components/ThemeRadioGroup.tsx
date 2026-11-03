import { useTranslation } from 'react-i18next';
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { useTheme, type ThemePreference } from '@/theme/theme-context';

/** Value of the radio group: a theme, or 'instance' when following the instance default. */
type ThemeChoice = ThemePreference | 'instance';

/** Radio items (light / dark / system / instance default) for a dropdown menu. */
export function ThemeRadioGroup() {
  const { t } = useTranslation();
  const { theme, source, setTheme } = useTheme();
  const current: ThemeChoice = source === 'instance' ? 'instance' : theme;
  return (
    <DropdownMenuRadioGroup
      value={current}
      onValueChange={(value) => setTheme(value === 'instance' ? null : (value as ThemePreference))}
    >
      <DropdownMenuRadioItem value="light">{t('common.theme.light')}</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark">{t('common.theme.dark')}</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="system">{t('common.theme.system')}</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="instance">{t('common.theme.instance')}</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
}
