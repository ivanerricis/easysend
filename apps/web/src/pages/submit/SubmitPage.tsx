import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { queryKeys } from '@/app/query';
import { PageHeader } from '@/components/common/PageHeader';
import { RequestId } from '@/components/common/RequestId';
import { LoadingState } from '@/components/common/States';
import { UnlockCard } from '@/components/common/UnlockCard';
import { PublicCard } from '@/components/layout/PublicLayout';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api/client';
import { getRequestInfo, unlockRequest } from '@/lib/api/submissions';
import { formatDateTime, formatRelative } from '@/lib/format';
import { SubmitView } from './SubmitView';

function errorStateKey(error: unknown): string {
  if (!isApiError(error)) return 'generic';
  switch (error.code) {
    case 'REQUEST_NOT_FOUND':
      return 'notFound';
    case 'REQUEST_EXPIRED':
      return 'expired';
    case 'REQUEST_REVOKED':
      return 'revoked';
    case 'REQUEST_FULL':
      return 'full';
    case 'RATE_LIMITED':
      return 'rateLimited';
    default:
      return 'generic';
  }
}

/** Full-page state with its own h1 (not found, expired, revoked, full, rate limit, generic). */
function ErrorView({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const key = errorStateKey(error);
  const retryable = key === 'rateLimited' || key === 'generic';
  const requestId = isApiError(error) ? error.requestId : undefined;
  return (
    <PublicCard width="default">
      <PageHeader title={t(`submit.states.${key}.title`)} />
      <p className="text-muted-foreground text-sm">{t(`submit.states.${key}.description`)}</p>
      {key === 'generic' ? <RequestId requestId={requestId} className="mt-3" /> : null}
      {retryable ? (
        <Button type="button" variant="outline" className="mt-6" onClick={onRetry}>
          {t('common.actions.retry')}
        </Button>
      ) : null}
    </PublicCard>
  );
}

/** Public page of an upload request: anyone with the link can send files to its owner. */
export default function SubmitPage() {
  const { t, i18n } = useTranslation();
  const { token = '' } = useParams();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.submitRequest(token),
    queryFn: ({ signal }) => getRequestInfo(token, signal),
    enabled: token !== '',
    retry: false,
    staleTime: 0,
  });

  const refetch = () => queryClient.invalidateQueries({ queryKey: queryKeys.submitRequest(token) });

  if (query.isError) {
    return <ErrorView error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (!query.data) {
    return (
      <PublicCard width="default">
        <PageHeader title={t('submit.title')} />
        <LoadingState label={t('submit.loading')} variant="skeleton" />
      </PublicCard>
    );
  }
  if (query.data.locked) {
    const { expiresAt } = query.data;
    return (
      <UnlockCard
        title={t('submit.locked.title')}
        description={t('submit.locked.description')}
        expiresLabel={t('submit.expires', {
          date: formatDateTime(expiresAt, i18n.language),
          relative: formatRelative(expiresAt, i18n.language),
        })}
        unlock={(password) => unlockRequest(token, { password })}
        onUnlocked={refetch}
      />
    );
  }
  return <SubmitView token={token} info={query.data} />;
}
