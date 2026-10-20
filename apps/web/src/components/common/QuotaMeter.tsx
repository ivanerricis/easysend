import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { Progress } from '@/components/ui/progress';
import { getMe } from '@/lib/api/me';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

interface QuotaMeterProps {
  usedBytes: number;
  /** `null` = unlimited. */
  quotaBytes: number | null;
  className?: string;
}

/** Storage usage bar with text ("1.2 GiB of 10 GiB"); turns to a warning text above 90%. */
export function QuotaMeter({ usedBytes, quotaBytes, className }: QuotaMeterProps) {
  const { t, i18n } = useTranslation();
  const used = formatBytes(usedBytes, i18n.language);
  const percent = quotaBytes ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : null;
  const nearlyFull = percent !== null && percent >= 90;
  return (
    <div className={cn('space-y-1.5', className)}>
      <p className="text-xs font-medium">{t('common.quota.label')}</p>
      {percent !== null ? (
        <Progress
          value={percent}
          aria-label={t('common.quota.label')}
          aria-valuetext={`${percent}%`}
          className="h-2"
        />
      ) : null}
      <p className="text-muted-foreground text-xs">
        {quotaBytes
          ? t('common.quota.usedOf', { used, quota: formatBytes(quotaBytes, i18n.language) })
          : t('common.quota.unlimited', { used })}
      </p>
      {nearlyFull ? <p className="text-destructive text-xs">{t('common.quota.full')}</p> : null}
    </div>
  );
}

/** QuotaMeter fed by `GET /api/me` (shared cache with the rest of the app). */
export function MyQuotaMeter({ className }: { className?: string }) {
  const { data } = useQuery({ queryKey: queryKeys.me, queryFn: getMe });
  if (!data) return null;
  return (
    <QuotaMeter usedBytes={data.usedBytes} quotaBytes={data.quotaBytes} className={className} />
  );
}
