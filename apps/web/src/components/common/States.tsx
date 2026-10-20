import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  title?: string;
  description?: ReactNode;
  /** Usually a Button / link to the next action. */
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** Nothing to show yet (empty list, no results). */
export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex flex-col items-center gap-3 px-4 py-12 text-center', className)}>
      <span className="text-muted-foreground" aria-hidden="true">
        {icon ?? <Inbox className="size-8" />}
      </span>
      <p className="font-medium">{title ?? t('common.states.emptyTitle')}</p>
      {description ? (
        <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  /** Shows a Retry button (usually `refetch`). */
  onRetry?: () => void;
  title?: string;
  className?: string;
}

/** Blocking error of a page or section: translated message, request id and optional retry. */
export function ErrorState({ error, onRetry, title, className }: ErrorStateProps) {
  const { t } = useTranslation();
  const requestId = isApiError(error) ? error.requestId : undefined;
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center gap-3 px-4 py-12 text-center', className)}
    >
      <AlertCircle aria-hidden="true" className="text-destructive size-8" />
      <p className="font-medium">{title ?? t('common.states.errorTitle')}</p>
      <p className="text-muted-foreground max-w-prose text-sm">{errorMessage(t, error)}</p>
      {requestId ? (
        <p className="text-muted-foreground text-xs">
          {t('common.states.requestId')}: <code className="font-mono">{requestId}</code>
        </p>
      ) : null}
      {onRetry ? (
        <Button type="button" variant="outline" onClick={onRetry}>
          {t('common.actions.retry')}
        </Button>
      ) : null}
    </div>
  );
}

interface LoadingStateProps {
  /** Text read by screen readers; defaults to "Loading…". */
  label?: string;
  /** `skeleton` shows placeholder bars, `spinner` a centered spinner. */
  variant?: 'spinner' | 'skeleton';
  /** Number of skeleton bars. */
  lines?: number;
  className?: string;
}

/** Loading placeholder announced politely (`role="status"`). */
export function LoadingState({
  label,
  variant = 'spinner',
  lines = 3,
  className,
}: LoadingStateProps) {
  const { t } = useTranslation();
  const text = label ?? t('common.states.loading');
  return (
    <div role="status" className={className}>
      {variant === 'spinner' ? (
        <div className="text-muted-foreground flex items-center justify-center gap-3 py-12 text-sm">
          <Loader2 aria-hidden="true" className="size-5 motion-safe:animate-spin" />
          <span>{text}</span>
        </div>
      ) : (
        <div className="space-y-3" aria-hidden="true">
          {Array.from({ length: lines }, (_, index) => (
            <Skeleton key={index} className="h-6 w-full" />
          ))}
        </div>
      )}
      {variant === 'skeleton' ? <span className="sr-only">{text}</span> : null}
    </div>
  );
}
