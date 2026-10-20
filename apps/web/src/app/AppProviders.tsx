import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AppearanceEffects, AppearanceProvider } from '@/app/providers/AppearanceProvider';
import { SessionProvider } from '@/app/providers/SessionProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LocaleProvider } from '@/i18n/LocaleProvider';
import { ThemeProvider } from '@/theme/ThemeProvider';

/**
 * Provider stack: query client, public settings (appearance), session, theme, locale.
 * Order matters: theme and locale read the session and the instance defaults.
 */
export function AppProviders({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider>
        <SessionProvider>
          <ThemeProvider>
            <LocaleProvider>
              <AppearanceEffects />
              <TooltipProvider>{children}</TooltipProvider>
            </LocaleProvider>
          </ThemeProvider>
        </SessionProvider>
      </AppearanceProvider>
    </QueryClientProvider>
  );
}
