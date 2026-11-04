import { PAGE_SIZE_DEFAULT, type UploadRequestDetail } from '@easysend/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Lock, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { queryKeys } from '@/app/query';
import { HintText } from '@/components/common/HintTooltip';
import { PageHeader } from '@/components/common/PageHeader';
import { Pager } from '@/components/common/Pager';
import { SelectInput } from '@/components/common/SelectInput';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useUrlSearch, useUrlState } from '@/hooks/use-url-state';
import { listUploadRequests } from '@/lib/api/requests';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CreatedLinkCard } from './CreatedLinkCard';
import { RequestActionsMenu } from './RequestActionsMenu';
import { RequestFormDialog } from './RequestFormDialog';
import { readRequestParams, receivedText, submissionsText } from './utils';

const STATUS_FILTERS = ['active', 'revoked', 'expired'] as const;

function Expires({ expiresAt }: { expiresAt: number | null }) {
  const { t, i18n } = useTranslation();
  if (expiresAt === null) return <span>{t('common.neverExpires')}</span>;
  return (
    <HintText content={formatDateTime(expiresAt, i18n.language)}>
      <time dateTime={new Date(expiresAt * 1000).toISOString()}>
        {formatRelative(expiresAt, i18n.language)}
      </time>
    </HintText>
  );
}

function Title({ title, hasPassword }: { title: string; hasPassword: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      {title}
      {hasPassword ? (
        <Lock
          aria-label={t('requests.detail.passwordSet')}
          role="img"
          className="text-muted-foreground ml-1.5 inline size-3.5 align-text-bottom"
        />
      ) : null}
    </>
  );
}

export default function RequestsPage() {
  const { t, i18n } = useTranslation();
  const { params, update, page } = useUrlState();
  const { status, q } = readRequestParams(params);
  const [search, setSearch] = useUrlSearch(q, update);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<UploadRequestDetail | null>(null);
  const locale = i18n.language;

  const query = { page, pageSize: PAGE_SIZE_DEFAULT, status, q: q || undefined };
  const list = useQuery({
    queryKey: queryKeys.requests.list(query),
    queryFn: () => listUploadRequests(query),
    placeholderData: keepPreviousData,
  });

  const filtered = Boolean(status || q);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  const newButton = (
    <Button type="button" onClick={() => setCreating(true)}>
      <Plus aria-hidden="true" />
      {t('requests.list.new')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('requests.title')}
        description={t('requests.list.description')}
        actions={newButton}
      />

      {created ? <CreatedLinkCard request={created} onDismiss={() => setCreated(null)} /> : null}

      <form
        role="search"
        aria-label={t('requests.list.filters')}
        onSubmit={(event) => event.preventDefault()}
        className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem]"
      >
        <div className="relative sm:col-span-2 lg:col-span-1">
          <label htmlFor="requests-search" className="sr-only">
            {t('requests.list.search')}
          </label>
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            id="requests-search"
            type="search"
            value={search}
            maxLength={100}
            placeholder={t('requests.list.searchPlaceholder')}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor="requests-status" className="sr-only">
            {t('requests.list.status')}
          </label>
          <SelectInput
            id="requests-status"
            value={status ?? ''}
            onValueChange={(value) => update({ status: value })}
            options={[
              { value: '', label: t('requests.list.allStatuses') },
              ...STATUS_FILTERS.map((value) => ({ value, label: t(`common.status.${value}`) })),
            ]}
          />
        </div>
      </form>

      {list.isPending ? (
        <LoadingState variant="skeleton" lines={5} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={filtered ? t('requests.list.noResults') : t('requests.list.emptyTitle')}
          description={
            filtered ? t('requests.list.noResultsHint') : t('requests.list.emptyDescription')
          }
          action={
            filtered ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSearch('');
                  update({ q: undefined, status: undefined });
                }}
              >
                {t('requests.list.clearFilters')}
              </Button>
            ) : (
              newButton
            )
          }
        />
      ) : (
        <div className={cn(list.isPlaceholderData && 'opacity-60')} aria-busy={list.isFetching}>
          <p className="text-muted-foreground mb-2 text-sm" role="status">
            {t('common.pagination.total', { count: list.data.total })}
          </p>

          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>{t('requests.list.columns.request')}</TableHead>
                <TableHead>{t('requests.list.columns.status')}</TableHead>
                <TableHead className="text-right">
                  {t('requests.list.columns.submissions')}
                </TableHead>
                <TableHead className="text-right">{t('requests.list.columns.size')}</TableHead>
                <TableHead>{t('requests.list.columns.expires')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('requests.list.columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="max-w-64 whitespace-normal">
                    <Link
                      to={`/requests/${request.id}`}
                      className="font-medium break-words underline-offset-4 hover:underline"
                    >
                      <Title title={request.title} hasPassword={request.hasPassword} />
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={request.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {submissionsText(request)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {receivedText(request, locale)}
                  </TableCell>
                  <TableCell>
                    <Expires expiresAt={request.expiresAt} />
                  </TableCell>
                  <TableCell>
                    <RequestActionsMenu request={request} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <ul className="space-y-3 md:hidden">
            {list.data.items.map((request) => (
              <li key={request.id} className="flex items-start gap-2">
                <Link
                  to={`/requests/${request.id}`}
                  className="border-border hover:bg-muted/50 block min-w-0 flex-1 space-y-2 border p-4"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 font-medium break-words">
                      <Title title={request.title} hasPassword={request.hasPassword} />
                    </span>
                    <StatusBadge status={request.status} />
                  </span>
                  <span className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>
                      {t('requests.list.columns.submissions')}:{' '}
                      <span className="font-mono">{submissionsText(request)}</span>
                    </span>
                    <span>
                      {t('requests.list.columns.size')}:{' '}
                      <span className="font-mono">{receivedText(request, locale)}</span>
                    </span>
                    <span>
                      {t('requests.list.columns.expires')}:{' '}
                      <Expires expiresAt={request.expiresAt} />
                    </span>
                  </span>
                </Link>
                <RequestActionsMenu request={request} />
              </li>
            ))}
          </ul>

          {pages > 1 ? (
            <Pager
              className="mt-6"
              page={page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              showTotal={false}
              onPageChange={(next) => update({ page: String(next) })}
            />
          ) : null}
        </div>
      )}

      <RequestFormDialog open={creating} onOpenChange={setCreating} onCreated={setCreated} />
    </>
  );
}
