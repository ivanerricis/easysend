import {
  DEFAULT_APPEARANCE,
  type Appearance,
  type AppMode,
  type BrandingAssets,
  type Locale,
  type PublicSettingsResponse,
} from '@easysend/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { queryKeys } from '@/app/query';
import { assetUrl } from '@/lib/api/settings';
import { getPublicSettings } from '@/lib/api/public';
import { appearanceCssVars, applyCssVars, type ResolvedTheme } from '@/lib/appearance';
import { useTheme } from '@/theme/theme-context';

const DEFAULT_LOGO: Record<ResolvedTheme, string> = {
  light: '/brand/easysend-horizontal.svg',
  dark: '/brand/easysend-horizontal-dark.svg',
};
const NO_ASSETS: BrandingAssets = {
  logoLight: null,
  logoDark: null,
  favicon: null,
  background: null,
};

export interface AppearanceContextValue {
  /** Raw public settings; undefined until loaded. */
  settings: PublicSettingsResponse | undefined;
  isLoading: boolean;
  error: unknown;
  /** Instance appearance (defaults while loading). */
  appearance: Appearance;
  assets: BrandingAssets;
  instanceName: string;
  /** `local` unless the API says otherwise. */
  appMode: AppMode;
  defaultLocale: Locale;
  /** True while unknown (loading) so nothing redirects to the wizard too early. */
  setupCompleted: boolean;
  /**
   * Logo for the given theme. A custom logo is used for its own theme; when only one custom
   * logo exists it serves both themes; with none, the built-in EasySend logo is returned.
   */
  logoUrl: (theme: ResolvedTheme) => string;
  /** Custom background image, or null. */
  backgroundUrl: string | null;
  /** Custom favicon, or null (the built-in one stays). */
  faviconUrl: string | null;
  /** Re-reads the public settings (after the wizard or an admin change). */
  refresh: () => Promise<void>;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

/** Public settings (`GET /api/public/settings`) exposed with branding helpers. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.publicSettings,
    queryFn: getPublicSettings,
    staleTime: 60_000,
  });
  const settings = query.data;

  const value = useMemo<AppearanceContextValue>(() => {
    const appearance = settings?.appearance ?? DEFAULT_APPEARANCE;
    const assets = settings?.assets ?? NO_ASSETS;
    const url = (kind: 'logoLight' | 'logoDark' | 'favicon' | 'background') => {
      const info = assets[kind];
      return info ? assetUrl(kind, info.updatedAt) : null;
    };
    return {
      settings,
      isLoading: query.isPending,
      error: query.error,
      appearance,
      assets,
      instanceName: appearance.instanceName,
      appMode: settings?.appMode ?? 'local',
      defaultLocale: settings?.defaultLocale ?? 'en',
      setupCompleted: settings?.setupCompleted ?? true,
      logoUrl: (theme) => {
        const own = theme === 'dark' ? url('logoDark') : url('logoLight');
        return own ?? url('logoLight') ?? url('logoDark') ?? DEFAULT_LOGO[theme];
      },
      backgroundUrl: url('background'),
      faviconUrl: url('favicon'),
      refresh: async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.publicSettings });
      },
    };
  }, [settings, query.isPending, query.error, queryClient]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppearance must be used within AppearanceProvider');
  return value;
}

/**
 * Applies the instance appearance to the document: CSS variables on `<html>` and a custom
 * favicon. Rendered inside `ThemeProvider` because the variables depend on the resolved theme.
 */
export function AppearanceEffects() {
  const { appearance, faviconUrl } = useAppearance();
  const { resolvedTheme } = useTheme();
  const appliedKeys = useRef<string[]>([]);

  useEffect(() => {
    const vars = appearanceCssVars(appearance, resolvedTheme);
    appliedKeys.current = applyCssVars(document.documentElement, vars, appliedKeys.current);
  }, [appearance, resolvedTheme]);

  useEffect(() => {
    if (!faviconUrl) return;
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = faviconUrl;
    link.dataset['customFavicon'] = 'true';
    const builtIn = Array.from(
      document.head.querySelectorAll<HTMLLinkElement>(
        'link[rel="icon"]:not([data-custom-favicon])',
      ),
    );
    for (const el of builtIn) el.remove();
    document.head.appendChild(link);
    return () => {
      link.remove();
      for (const el of builtIn) document.head.appendChild(el);
    };
  }, [faviconUrl]);

  return null;
}
