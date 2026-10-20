import { contrastRatio, readableTextColor } from '@easysend/shared';
import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  LIGHT_SURFACE,
  TEXT_CONTRAST,
  UI_CONTRAST,
  contrastWarnings,
  type ContrastCheckId,
} from '@/lib/appearance';

interface ContrastPanelProps {
  primaryColor: string;
  accentColor: string;
}

type MainCheckId = Exclude<ContrastCheckId, 'darkPrimaryFallback' | 'darkAccentFallback'>;

const MAIN_CHECKS: {
  id: MainCheckId;
  ratio: (primary: string, accent: string) => number;
  required: number;
}[] = [
  {
    id: 'primaryText',
    ratio: (p) => contrastRatio(p, readableTextColor(p)),
    required: TEXT_CONTRAST,
  },
  { id: 'primaryOnLight', ratio: (p) => contrastRatio(p, LIGHT_SURFACE), required: UI_CONTRAST },
  {
    id: 'accentText',
    ratio: (_p, a) => contrastRatio(a, readableTextColor(a)),
    required: TEXT_CONTRAST,
  },
  { id: 'accentOnLight', ratio: (_p, a) => contrastRatio(a, LIGHT_SURFACE), required: UI_CONTRAST },
  {
    id: 'accentAsText',
    ratio: (_p, a) => contrastRatio(a, LIGHT_SURFACE),
    required: TEXT_CONTRAST,
  },
];

/** WCAG contrast checks of the chosen colours: ratio, requirement and result as text + icon. */
export function ContrastPanel({ primaryColor, accentColor }: ContrastPanelProps) {
  const { t } = useTranslation();
  const warnings = contrastWarnings({ primaryColor, accentColor });
  const failing = new Set(warnings.map((warning) => warning.id));
  const notices = warnings.filter(
    (warning) => warning.id === 'darkPrimaryFallback' || warning.id === 'darkAccentFallback',
  );
  const failedCount = MAIN_CHECKS.filter((check) => failing.has(check.id)).length;

  return (
    <section aria-labelledby="appearance-contrast" className="space-y-3">
      <div className="space-y-1">
        <h2 id="appearance-contrast" className="text-lg font-semibold">
          {t('admin.appearance.contrast.title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('admin.appearance.contrast.help')}</p>
      </div>
      <p role="status" className="text-sm font-medium">
        {failedCount === 0
          ? t('admin.appearance.contrast.allPass')
          : t('admin.appearance.contrast.someFail', { count: failedCount })}
      </p>
      <ul className="divide-border border-border divide-y border">
        {MAIN_CHECKS.map((check) => {
          const failed = failing.has(check.id);
          const ratio = check.ratio(primaryColor, accentColor);
          return (
            <li
              key={check.id}
              data-testid={`contrast-${check.id}`}
              data-result={failed ? 'fail' : 'pass'}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3 text-sm"
            >
              <span className="min-w-0 flex-1 basis-60">
                {t(`admin.appearance.contrast.checks.${check.id}`)}
              </span>
              <span className="flex items-center gap-3">
                <span className="font-mono">
                  {ratio.toFixed(2)}:1
                  <span className="text-muted-foreground">
                    {' '}
                    ({t('admin.appearance.contrast.required', { value: check.required })})
                  </span>
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 font-medium ${failed ? 'text-destructive' : ''}`}
                >
                  {failed ? (
                    <XCircle aria-hidden="true" className="size-4" />
                  ) : (
                    <CheckCircle2 aria-hidden="true" className="size-4" />
                  )}
                  {failed
                    ? t('admin.appearance.contrast.fail')
                    : t('admin.appearance.contrast.pass')}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {notices.length > 0 ? (
        <ul className="space-y-2">
          {notices.map((notice) => (
            <li
              key={notice.id}
              data-testid={`contrast-${notice.id}`}
              className="text-muted-foreground flex items-start gap-2 text-sm"
            >
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                {t(`admin.appearance.contrast.checks.${notice.id}`)}{' '}
                <span className="font-mono">({notice.ratio.toFixed(2)}:1)</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
