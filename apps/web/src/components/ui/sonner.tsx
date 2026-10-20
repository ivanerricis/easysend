import { useTranslation } from 'react-i18next';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTheme } from '@/theme/theme-context';

/** Bottom-center on narrow screens, bottom-right otherwise; theme follows our ThemeProvider. */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  return (
    <Sonner
      theme={resolvedTheme}
      position={isMobile ? 'bottom-center' : 'bottom-right'}
      closeButton
      containerAriaLabel={t('common.notifications')}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" aria-hidden="true" />,
        info: <InfoIcon className="size-4" aria-hidden="true" />,
        warning: <TriangleAlertIcon className="size-4" aria-hidden="true" />,
        error: <OctagonXIcon className="size-4" aria-hidden="true" />,
        loading: <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
