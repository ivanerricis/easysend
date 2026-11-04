import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Support reference of a failed request ("Request ID: ..."), or nothing without one. */
export function RequestId({ requestId, className }: { requestId?: string; className?: string }) {
  const { t } = useTranslation();
  if (!requestId) return null;
  return (
    <p className={cn('text-muted-foreground text-xs', className)}>
      {t('common.states.requestId')}: <code className="font-mono">{requestId}</code>
    </p>
  );
}
