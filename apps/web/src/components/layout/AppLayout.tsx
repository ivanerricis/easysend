import {
  ChevronRight,
  ChevronsUpDown,
  ArrowUpCircle,
  HardDrive,
  Inbox,
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
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { useSession } from '@/app/providers/SessionProvider';
import { MyQuotaMeter } from '@/components/common/QuotaMeter';
import { LoadingState } from '@/components/common/States';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { SkipLink } from '@/components/layout/PublicLayout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { useUpdateStatus } from '@/hooks/use-update-status';
import { notifyError } from '@/lib/toast';
import { LocaleRadioGroup } from '@/components/LocaleRadioGroup';
import { ThemeRadioGroup } from '@/components/ThemeRadioGroup';
import { useTheme } from '@/theme/theme-context';

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
}

const MAIN_NAV: NavItem[] = [
  { to: '/', labelKey: 'common.nav.send', icon: Send },
  { to: '/transfers', labelKey: 'common.nav.transfers', icon: Share2 },
  { to: '/requests', labelKey: 'common.nav.requests', icon: Inbox },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin/users', labelKey: 'common.nav.users', icon: Users },
  { to: '/admin/transfers', labelKey: 'common.nav.allTransfers', icon: Library },
  { to: '/admin/storage', labelKey: 'common.nav.storage', icon: HardDrive },
  { to: '/admin/appearance', labelKey: 'common.nav.appearance', icon: Palette },
];

const SETTINGS_PATH = '/admin/settings';
const SETTINGS_NAV: Omit<NavItem, 'icon'>[] = [
  { to: `${SETTINGS_PATH}/general`, labelKey: 'admin.settings.nav.general' },
  { to: `${SETTINGS_PATH}/email`, labelKey: 'admin.settings.nav.email' },
  { to: `${SETTINGS_PATH}/cloudflare`, labelKey: 'admin.settings.nav.cloudflare' },
  { to: `${SETTINGS_PATH}/updates`, labelKey: 'admin.settings.nav.updates' },
  { to: `${SETTINGS_PATH}/storage`, labelKey: 'admin.settings.nav.storage' },
];

function isActivePath(current: string, to: string): boolean {
  return to === '/' ? current === '/' : current === to || current.startsWith(`${to}/`);
}

function NavGroup({
  label,
  items,
  after,
}: {
  label?: string;
  items: NavItem[];
  after?: ReactNode;
}) {
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
        {after}
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * "Settings" entry of the admin menu with its four sub-pages: a collapsible submenu in the
 * expanded sidebar and the mobile sheet, a dropdown menu next to the icon when the desktop
 * sidebar is collapsed to icons.
 */
function SettingsNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { state, isMobile } = useSidebar();
  const active = isActivePath(pathname, SETTINGS_PATH);
  const [open, setOpen] = useState(active);
  const text = t('common.nav.settings');

  // Arriving in the settings from elsewhere (e.g. the update notice) opens the submenu.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setOpen(true);
  }

  if (state === 'collapsed' && !isMobile) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton isActive={active} tooltip={text} aria-label={text}>
              <Settings aria-hidden="true" />
              <span>{text}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="min-w-48">
            <DropdownMenuLabel>{text}</DropdownMenuLabel>
            {SETTINGS_NAV.map((item) => (
              <DropdownMenuItem key={item.to} asChild>
                <Link
                  to={item.to}
                  aria-current={isActivePath(pathname, item.to) ? 'page' : undefined}
                >
                  {t(item.labelKey)}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={text}>
            <Settings aria-hidden="true" />
            <span>{text}</span>
            <ChevronRight
              aria-hidden="true"
              className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90 motion-reduce:transition-none"
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {SETTINGS_NAV.map((item) => {
              const itemActive = isActivePath(pathname, item.to);
              return (
                <SidebarMenuSubItem key={item.to}>
                  <SidebarMenuSubButton asChild isActive={itemActive}>
                    <Link to={item.to} aria-current={itemActive ? 'page' : undefined}>
                      <span>{t(item.labelKey)}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function UserMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useSession();
  const { isMobile } = useSidebar();
  if (!user) return null;

  const name = user.displayName ?? user.email;

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
            <ThemeRadioGroup />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t('common.userMenu.language')}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <LocaleRadioGroup />
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

/** Admin-only link to the updates settings, shown when a newer release is published. */
function UpdateNotice() {
  const { t } = useTranslation();
  const { isAdmin } = useSession();
  const { data } = useUpdateStatus(isAdmin);
  if (!isAdmin || !data?.updateAvailable || !data.latestVersion) return null;
  const text = t('common.updateNotice.label');
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild tooltip={`${text}: ${data.latestVersion}`}>
          <Link
            to="/admin/settings/updates"
            aria-label={t('common.updateNotice.aria', { version: data.latestVersion })}
          >
            <ArrowUpCircle aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{text}</span>
            <Badge variant="secondary" className="font-mono group-data-[collapsible=icon]:hidden">
              {data.latestVersion}
            </Badge>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
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
          {isAdmin ? (
            <NavGroup label={t('common.nav.admin')} items={ADMIN_NAV} after={<SettingsNav />} />
          ) : null}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2 group-data-[collapsible=icon]:hidden">
          <MyQuotaMeter />
        </div>
        <UpdateNotice />
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
