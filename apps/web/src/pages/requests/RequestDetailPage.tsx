import { useQuery } from '@tanstack/react-query';
import { Ban, Pencil, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { queryKeys } from '@/app/query';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { CopyButton } from '@/components/common/CopyButton';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isApiError } from '@/lib/api/client';
import { getUploadRequest } from '@/lib/api/requests';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import { ReceivedFrom } from '../transfers/ReceivedFrom';
import { transferTitle } from '../transfers/list-utils';
import { RequestFormDialog } from './RequestFormDialog';
import { useRequestActions } from './useRequestActions';
import { receivedText, submissionsText } from './utils';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function RequestDetailPage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'revoke' | 'delete' | null>(null);
  const { revoke, remove: removeRequest } = useRequestActions(id);
  const locale = i18n.language;

  const query = useQuery({
    queryKey: queryKeys.requests.detail(id),
    queryFn: () => getUploadRequest(id),
  });

  if (query.isPending) {
    return (
      <>
        <PageHeader title={t('requests.detailTitle')} />
        <LoadingState variant="skeleton" lines={6} />
      </>
    );
  }
  if (query.isError) {
    const notFound = isApiError(query.error) && query.error.code === 'REQUEST_NOT_FOUND';
    return (
      <>
        <PageHeader
          title={notFound ? t('requests.detail.notFoundTitle') : t('requests.detailTitle')}
        />
        {notFound ? (
          <EmptyState
            title={t('requests.detail.notFoundTitle')}
            description={t('errors.REQUEST_NOT_FOUND')}
            action={
              <Button asChild variant="outline">
                <Link to="/requests">{t('requests.detail.backToList')}</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </>
    );
  }

  const request = query.data;
  const isActive = request.status === 'active';
  const asked = [
    request.requireName ? t('requests.detail.askedName') : null,
    request.requireEmail ? t('requests.detail.askedEmail') : null,
  ].filter(Boolean);

  const remove = async () => {
    await removeRequest();
    void navigate('/requests');
  };

  const actions = (
    <>
      {isActive ? (
        <Button type="button" variant="outline" onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" />
          {t('common.actions.edit')}
        </Button>
      ) : null}
      {isActive ? (
        <Button type="button" variant="outline" onClick={() => setConfirm('revoke')}>
          <Ban aria-hidden="true" />
          {t('common.actions.revoke')}
        </Button>
      ) : null}
      <Button type="button" variant="destructive" onClick={() => setConfirm('delete')}>
        <Trash2 aria-hidden="true" />
        {t('common.actions.delete')}
      </Button>
    </>
  );

  return (
    <>
      <PageHeader title={request.title} actions={actions} />
      <div className="max-w-4xl space-y-8">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={request.status} />
          <Button asChild variant="link" className="px-0 underline underline-offset-4">
            <Link to="/requests">{t('requests.detail.backToList')}</Link>
          </Button>
        </div>

        <Section id="share-heading" title={t('requests.detail.shareLink')}>
          {isActive && request.shareUrl ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="share-url"
                readOnly
                aria-labelledby="share-heading"
                value={request.shareUrl}
                className="font-mono"
                onFocus={(event) => event.currentTarget.select()}
              />
              <CopyButton value={request.shareUrl}>{t('requests.created.copy')}</CopyButton>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{t('requests.detail.inactiveLink')}</p>
          )}
        </Section>

        <Section id="facts-heading" title={t('requests.detail.details')}>
          <dl className="border-border grid gap-x-6 gap-y-4 border p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('requests.detail.created')}>
              {formatDateTime(request.createdAt, locale)}
            </Fact>
            <Fact label={t('requests.detail.expires')}>
              <time dateTime={new Date(request.expiresAt * 1000).toISOString()}>
                {formatDateTime(request.expiresAt, locale)}
              </time>{' '}
              <span className="text-muted-foreground">
                ({formatRelative(request.expiresAt, locale)})
              </span>
            </Fact>
            <Fact label={t('requests.detail.password')}>
              {request.hasPassword
                ? t('requests.detail.passwordSet')
                : t('requests.detail.passwordNone')}
            </Fact>
            <Fact label={t('requests.detail.maxSubmissions')}>
              <span className="font-mono">{submissionsText(request)}</span>
              {request.maxSubmissions === null ? (
                <span className="text-muted-foreground"> ({t('requests.unlimited')})</span>
              ) : null}
            </Fact>
            <Fact label={t('requests.detail.maxSize')}>
              <span className="font-mono">{receivedText(request, locale)}</span>
              {request.maxTotalBytes === null ? (
                <span className="text-muted-foreground"> ({t('requests.unlimited')})</span>
              ) : null}
            </Fact>
            <Fact label={t('requests.detail.askedFields')}>
              {asked.length > 0 ? asked.join(', ') : t('requests.detail.askedNone')}
            </Fact>
          </dl>
        </Section>

        {request.message ? (
          <Section id="message-heading" title={t('requests.detail.message')}>
            <p className="border-border border p-4 text-sm break-words whitespace-pre-wrap">
              {request.message}
            </p>
          </Section>
        ) : null}

        <Section id="transfers-heading" title={t('requests.detail.transfers')}>
          {request.transfers.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('requests.detail.noTransfers')}</p>
          ) : (
            <ul className="divide-border border-border divide-y border">
              {request.transfers.map((transfer) => (
                <li
                  key={transfer.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 basis-48 space-y-0.5">
                    <Link
                      to={`/transfers/${transfer.id}`}
                      className="block text-sm font-medium break-words underline-offset-4 hover:underline"
                    >
                      {transferTitle(transfer, t('transfers.list.untitled'))}
                    </Link>
                    <ReceivedFrom
                      transfer={transfer}
                      className="text-muted-foreground flex items-center gap-1 text-xs"
                    />
                  </span>
                  <StatusBadge status={transfer.status} />
                  <span className="text-muted-foreground font-mono text-xs">
                    {formatBytes(transfer.totalBytes, locale)} ·{' '}
                    {t('common.units.files', { count: transfer.fileCount })}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {formatDateTime(transfer.createdAt, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {isActive ? (
        <RequestFormDialog request={request} open={editing} onOpenChange={setEditing} />
      ) : null}
      <ConfirmDialog
        open={confirm === 'revoke'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('requests.revokeTitle')}
        description={t('requests.revokeDescription')}
        confirmLabel={t('common.actions.revoke')}
        destructive
        onConfirm={revoke}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('requests.deleteTitle')}
        description={t('requests.deleteDescription')}
        confirmLabel={t('common.actions.delete')}
        destructive
        onConfirm={remove}
      />
    </>
  );
}
