import type { Appearance } from '@easysend/shared';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { appearanceCssVars, applyCssVars, type ResolvedTheme } from '@/lib/appearance';

/**
 * Light theme tokens written explicitly on the light preview: the page itself may be dark (or
 * carry a custom saved appearance) and custom properties are inherited, so without these the
 * "light" box would not be light.
 */
const LIGHT_BASE: Record<string, string> = {
  '--background': 'oklch(1 0 0)',
  '--foreground': 'oklch(0.141 0.005 285.823)',
  '--card': 'oklch(1 0 0)',
  '--muted': 'oklch(0.967 0.001 286.375)',
  '--muted-foreground': 'oklch(0.442 0.017 285.786)',
  '--primary': 'oklch(0.21 0.006 285.885)',
  '--primary-foreground': 'oklch(0.985 0 0)',
  '--accent': 'oklch(0.508 0.118 165.612)',
  '--accent-foreground': 'oklch(1 0 0)',
  '--border': 'oklch(0.92 0.004 286.32)',
  '--input': 'oklch(0.552 0.016 285.938)',
  '--ring': 'oklch(0.508 0.118 165.612)',
};

const PLEX_FONT = "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif";

type PreviewValues = Pick<
  Appearance,
  'instanceName' | 'footer' | 'primaryColor' | 'accentColor' | 'radius' | 'font'
>;

function PreviewBox({ theme, values }: { theme: ResolvedTheme; values: PreviewValues }) {
  const { t } = useTranslation();
  const { logoUrl, backgroundUrl } = useAppearance();
  const ref = useRef<HTMLDivElement>(null);
  const applied = useRef<string[]>([]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const vars = {
      ...(theme === 'light' ? LIGHT_BASE : {}),
      '--app-font-sans': PLEX_FONT,
      ...appearanceCssVars(values, theme),
    };
    applied.current = applyCssVars(element, vars, applied.current);
  }, [theme, values]);

  const title =
    theme === 'light' ? t('admin.appearance.preview.light') : t('admin.appearance.preview.dark');
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div
        ref={ref}
        data-testid={`preview-${theme}`}
        aria-hidden="true"
        className={`${theme === 'dark' ? 'dark ' : ''}bg-background text-foreground border-border overflow-hidden border`}
        style={{ fontFamily: 'var(--app-font-sans)' }}
      >
        <div
          className="space-y-4 p-4"
          style={
            backgroundUrl
              ? { backgroundImage: `url(${backgroundUrl})`, backgroundSize: 'cover' }
              : undefined
          }
        >
          <div className="bg-card border-border space-y-4 border p-4">
            <img
              src={logoUrl(theme)}
              alt=""
              className="h-8 w-auto max-w-full object-contain object-left"
            />
            <div className="space-y-1">
              <p className="text-base font-semibold">{values.instanceName}</p>
              <p className="text-muted-foreground text-sm">
                {t('admin.appearance.preview.sample')}{' '}
                <span className="text-accent underline underline-offset-4">
                  {t('admin.appearance.preview.link')}
                </span>
              </p>
            </div>
            <div className="border-input text-muted-foreground flex h-10 items-center border px-3 text-sm">
              {t('admin.appearance.preview.input')}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="bg-primary text-primary-foreground inline-flex h-10 items-center px-4 text-sm font-medium">
                {t('admin.appearance.preview.button')}
              </span>
              <span className="bg-accent text-accent-foreground inline-flex h-6 items-center px-2 text-xs font-medium">
                {t('admin.appearance.preview.badge')}
              </span>
            </div>
          </div>
          {values.footer.trim() ? (
            <p className="text-muted-foreground border-border border-t pt-2 text-center text-xs">
              {values.footer}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Miniature public page in both themes, driven by the (unsaved) form values. */
export function AppearancePreview({ values }: { values: PreviewValues }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="appearance-preview" className="space-y-3">
      <div className="space-y-1">
        <h2 id="appearance-preview" className="text-lg font-semibold">
          {t('admin.appearance.preview.title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('admin.appearance.preview.help')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <PreviewBox theme="light" values={values} />
        <PreviewBox theme="dark" values={values} />
      </div>
    </section>
  );
}
