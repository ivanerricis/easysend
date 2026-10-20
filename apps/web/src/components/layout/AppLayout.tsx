import {
  ChevronsUpDown,
  HardDrive,
  LogOut,
  Palette,
  Send,
  Settings,
  Share2,
  User as UserIcon,
  Users,
  Library,
  type LucideIcon,
} from 'lucide-react';
import { Suspense, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { useSession } from '@/app/providers/SessionProvider';
import { MyQuotaMeter } from '@/components/common/QuotaMeter';
import { LoadingState } from '@/components/common/States';
import { SkipLink } from '@/components/layout/PublicLayout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { SUPPORTED_LOCALES, type Locale } from '@/i18n';
import { useLocale } from '@/i18n/LocaleProvider';
import { notifyError } from '@/lib/toast';
import { useTheme, type ThemePreference } from '@/theme/theme-context';

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
}

const MAIN_NAV: NavItem[] = [
  { to: '/', labelKey: 'common.nav.send', icon: Send },
  { to: '/transfers', labelKey: 'common.nav.transfers', icon: Share2 },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin/users', labelKey: 'common.nav.users', icon: Users },
  { to: '/admin/transfers', labelKey: 'common.nav.allTransfers', icon: Library },
  { to: '/admin/storage', labelKey: 'common.nav.storage', icon: HardDrive },
  { to: '/admin/settings', labelKey: 'common.nav.settings', icon: Settings },
  { to: '/admin/appearance', labelKey: 'common.nav.appearance', icon: Palette },
];

const LOCALE_NAMES: Record<Locale, string> = { it: 'Italiano', en: 'English' };

function isActivePath(current: string, to: string): boolean {
  return to === '/' ? current === '/' : current === to || current.startsWith(`${to}/`);
}

function NavGroup({ label, items }: { label?: string; items: NavItem[] }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  return (
    <SidebarGroup>
      {label ? <SidebarGroupLabel>{label}</SidebarGroupLabel> : null}
      <SidebarMenu>
        {items.map((item) => {
          const active = isActivePath(pathname, item.to);
          const text = t(item.labelKey);
          return (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton asChild isActive={active} tooltip={text}>
                <Link to={item.to} aria-current={active ? 'page' : undefined}>
                  <item.icon aria-hidden="true" />
                  <span>{text}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function UserMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useSession();
  const { theme, source, setTheme } = useTheme();
  const { locale, changeLocale } = useLocale();
  const { isMobile } = useSidebar();
  if (!user) return null;

  const name = user.displayName ?? user.email;
  const themeChoice = source === 'instance' ? 'instance' : theme;

  const onLogout = async () => {
    try {
      await logout();
      void navigate('/login', { replace: true });
    } catch {
      notifyError(t('errors.generic'));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          aria-label={`${t('common.userMenu.label')}: ${name}`}
          tooltip={name}
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <UserIcon aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <ChevronsUpDown aria-hidden="true" className="ml-auto" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={isMobile ? 'top' : 'right'} align="end" className="min-w-56">
        <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/profile">
            <UserIcon aria-hidden="true" />
            {t('common.userMenu.profile')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t('common.userMenu.theme')}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={themeChoice}
              onValueChange={(value) =>
                setTheme(value === 'instance' ? null : (value as ThemePreference))
              }
            >
              <DropdownMenuRadioItem value="light">{t('common.theme.light')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">{t('common.theme.dark')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                {t('common.theme.system')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="instance">
                {t('common.theme.instance')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t('common.userMenu.language')}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
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
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void onLogout()}>
          <LogOut aria-hidden="true" />
          {t('common.userMenu.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppSidebar() {
  const { t } = useTranslation();
  const { isAdmin } = useSession();
  const { instanceName, logoUrl, faviconUrl } = useAppearance();
  const { resolvedTheme } = useTheme();
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();

  // The mobile sheet closes after navigating.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/" className="flex min-h-11 items-center px-1" aria-label={instanceName}>
          <img
            src={logoUrl(resolvedTheme)}
            alt={instanceName}
            className="h-7 w-auto max-w-44 object-contain object-left group-data-[collapsible=icon]:hidden"
          />
          <img
            src={faviconUrl ?? '/favicon.svg'}
            alt=""
            aria-hidden="true"
            className="hidden size-7 object-contain group-data-[collapsible=icon]:block"
          />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={t('common.nav.main')}>
          <NavGroup items={MAIN_NAV} />
          {isAdmin ? <NavGroup label={t('common.nav.admin')} items={ADMIN_NAV} /> : null}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2 group-data-[collapsible=icon]:hidden">
          <MyQuotaMeter />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * Layout of the logged-in area: collapsible sidebar (a sheet on mobile), a top bar with the
 * sidebar trigger and `main#main` holding the routed page. Admin entries appear only for admins.
 */
export function AppLayout({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const { instanceName, appearance } = useAppearance();

  return (
    <SidebarProvider>
      <SkipLink />
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background sticky top-0 z-10 flex h-14 items-center gap-3 border-b px-3 sm:px-4">
          <SidebarTrigger />
          <span className="truncate text-sm font-medium md:hidden">{instanceName}</span>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8"
        >
          {children ?? (
            <Suspense fallback={<LoadingState label={t('common.states.loadingPage')} />}>
              <Outlet />
            </Suspense>
          )}
        </main>
        {appearance.footer ? (
          <footer className="border-t">
            <p className="text-muted-foreground px-4 py-4 text-sm sm:px-6">{appearance.footer}</p>
          </footer>
        ) : null}
      </div>
    </SidebarProvider>
  );
}
