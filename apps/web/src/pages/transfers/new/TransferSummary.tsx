import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatBytes } from '@/lib/format';

interface QuotaMeterProps {
  /** Total quota in bytes, or null when the user has none (nothing is shown). */
  quotaBytes: number | null;
  usedBytes: number;
  /** Size of the selected files, counted on top of what is already used. */
  selectedBytes: number;
}

/** Compact quota usage; rendered only when the user has a quota. */
export function QuotaMeter({ quotaBytes, usedBytes, selectedBytes }: QuotaMeterProps) {
  const { t, i18n } = useTranslation();
  if (quotaBytes === null) return null;
  const remaining = Math.max(0, quotaBytes - usedBytes);
  const percent =
    quotaBytes > 0 ? Math.min(100, ((usedBytes + selectedBytes) / quotaBytes) * 100) : 100;
  return (
    <div className="space-y-1.5">
      <Progress value={percent} aria-label={t('transfers.new.quotaLabel')} className="h-1.5" />
      <p className="text-muted-foreground text-xs tabular-nums">
        {t('transfers.new.quotaRemaining', {
          remaining: formatBytes(remaining, i18n.language),
          quota: formatBytes(quotaBytes, i18n.language),
        })}
      </p>
    </div>
  );
}

interface SubmitBarProps {
  fileCount: number;
  totalBytes: number;
  label: string;
  disabled?: boolean;
}

/**
 * Total and primary action. Bottom bar fixed to the viewport below `lg` (clear of the sidebar
 * rail and the iOS home indicator); at the bottom of the sticky panel from `lg` up.
 */
export function SubmitBar({ fileCount, totalBytes, label, disabled }: SubmitBarProps) {
  const { t, i18n } = useTranslation();
  return (
    <div className="bg-background border-border fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:left-(--sidebar-width) md:group-has-[[data-side][data-state=collapsed]]/sidebar-wrapper:left-(--sidebar-width-icon) lg:static lg:flex-col lg:items-stretch lg:gap-3 lg:border-t lg:bg-transparent lg:px-0 lg:pt-4 lg:pb-0">
      <p className="min-w-0 flex-1 text-sm tabular-nums lg:flex-none" data-testid="summary-total">
        {fileCount === 0 ? (
          <span className="text-muted-foreground">{t('transfers.new.summaryEmpty')}</span>
        ) : (
          <>
            <span className="font-medium">{t('common.units.files', { count: fileCount })}</span>
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, </span>
            <span>{formatBytes(totalBytes, i18n.language)}</span>
          </>
        )}
      </p>
      <Button type="submit" size="lg" disabled={disabled} className="lg:w-full">
        {label}
      </Button>
    </div>
  );
}
