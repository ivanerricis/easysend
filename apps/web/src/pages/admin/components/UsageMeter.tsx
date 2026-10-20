import { useTranslation } from 'react-i18next';
import { Progress } from '@/components/ui/progress';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

interface UsageMeterProps {
  usedBytes: number;
  /** `null` = no quota. */
  quotaBytes: number | null;
  /** Accessible name of the bar (usually the user's email). */
  label: string;
  className?: string;
}

/** Compact usage meter: mini bar plus mono numbers ("1.2 GiB / 10 GiB", percentage as text). */
export function UsageMeter({ usedBytes, quotaBytes, label, className }: UsageMeterProps) {
  const { t, i18n } = useTranslation();
  const used = formatBytes(usedBytes, i18n.language);
  const percent = quotaBytes ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : null;
  return (
    <div className={cn('min-w-32 space-y-1', className)}>
      {percent !== null ? (
        <Progress
          value={percent}
          aria-label={t('admin.usage.meterLabel', { name: label })}
          aria-valuetext={`${percent}%`}
          className="h-1.5"
        />
      ) : null}
      <p className="font-mono text-xs">
        {quotaBytes ? (
          <>
            {used} / {formatBytes(quotaBytes, i18n.language)}
            <span className="text-muted-foreground"> ({percent}%)</span>
          </>
        ) : (
          <>
            {used} <span className="text-muted-foreground">{t('admin.usage.noQuota')}</span>
          </>
        )}
      </p>
    </div>
  );
}
