import {
  createContext,
  Suspense,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import { Link, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { LoadingState } from '@/components/common/States';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { cn } from '@/lib/utils';
import { useTheme } from '@/theme/theme-context';

export function SkipLink() {
  const { t } = useTranslation();
  return (
    <a
      href="#main"
      className="bg-primary text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-3"
      onClick={(event) => {
        const main = document.getElementById('main');
        if (!main) return;
        event.preventDefault();
        main.focus();
      }}
    >
      {t('common.skipToContent')}
    </a>
  );
}

const CARD_WIDTH = {
  /** Login, reset password (28rem). */
  narrow: 'max-w-md',
  /** Default forms and the download page (36rem). */
  default: 'max-w-xl',
  /** Setup wizard (48rem). */
  wide: 'max-w-3xl',
} as const;

export type PublicCardWidth = keyof typeof CARD_WIDTH;

/** Lets the card tell the layout its width, so header and footer share the card's column. */
const PublicWidthContext = createContext<((width: PublicCardWidth) => void) | null>(null);

/**
 * Centered content box of the public pages (a bordered card on the page background).
 * `width`: `narrow` (28rem), `default` (36rem), `wide` (48rem, setup wizard).
 */
export function PublicCard({
  width = 'default',
  className,
  children,
}: {
  width?: PublicCardWidth;
  className?: string;
  children: ReactNode;
}) {
  const setLayoutWidth = useContext(PublicWidthContext);
  // Before paint: the header never shows at another width first.
  useLayoutEffect(() => setLayoutWidth?.(width), [setLayoutWidth, width]);
  return (
    <div
      className={cn(
        'bg-card text-card-foreground w-full border p-5 sm:p-8',
        CARD_WIDTH[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Layout of the pages that do not need a login (login, reset password, setup wizard, download).
 * Skip link, header with logo + language / theme, `main#main`, optional branding background
 * and footer. Render the page content inside `PublicCard`.
 */
export function PublicLayout({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const { appearance, backgroundUrl, logoUrl, instanceName } = useAppearance();
  const { resolvedTheme } = useTheme();
  const [width, setWidth] = useState<PublicCardWidth>('default');
  // Same outer padding as `main` and the card's max width: logo, card and footer share one edge.
  const column = cn('mx-auto w-full', CARD_WIDTH[width]);

  return (
    <PublicWidthContext.Provider value={setWidth}>
      <div
        className="bg-background relative flex min-h-dvh flex-col bg-cover bg-center"
        style={backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")` } : undefined}
      >
        {/* Solid overlay keeps text contrast over any background image. */}
        {backgroundUrl ? (
          <div
            aria-hidden="true"
            className="bg-background/90 pointer-events-none absolute inset-0"
          />
        ) : null}
        <SkipLink />
        <header className="relative px-4 sm:px-6">
          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3',
              column,
            )}
          >
            <Link to="/" className="inline-flex min-h-11 items-center" aria-label={instanceName}>
              <img
                src={logoUrl(resolvedTheme)}
                alt={instanceName}
                className="h-8 w-auto max-w-48 object-contain object-left"
              />
            </Link>
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <ThemeSwitcher />
            </div>
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="relative mx-auto flex w-full flex-1 flex-col items-center px-4 py-8 outline-none sm:px-6 sm:py-12"
        >
          {children ?? (
            <Suspense fallback={<LoadingState label={t('common.states.loadingPage')} />}>
              <Outlet />
            </Suspense>
          )}
        </main>
        {appearance.footer ? (
          <footer className="relative border-t px-4 sm:px-6">
            <p className={cn('text-muted-foreground py-4 text-sm', column)}>{appearance.footer}</p>
          </footer>
        ) : null}
      </div>
    </PublicWidthContext.Provider>
  );
}
