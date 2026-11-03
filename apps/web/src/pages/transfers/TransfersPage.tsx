import { PAGE_SIZE_DEFAULT, type TransferMode, type TransferSummary } from '@easysend/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link2, Mail, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { queryKeys } from '@/app/query';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUrlSearch, useUrlState } from '@/hooks/use-url-state';
import { Pager } from '@/components/common/Pager';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { HintText } from '@/components/common/HintTooltip';
import { SelectInput } from '@/components/common/SelectInput';
import { listTransfers } from '@/lib/api/transfers';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ShareLinkButton } from './actions/ShareLinkButton';
import { TransferActionsMenu } from './actions/TransferActionsMenu';
import { downloadsText, readListParams, transferTitle } from './list-utils';

const STATUS_FILTERS = ['active', 'uploading', 'revoked', 'expired'] as const;

function ModeLabel({
  mode,
  link,
  title,
}: {
  mode: TransferMode;
  link?: string | null;
  title: string;
}) {
  const { t } = useTranslation();
  const Icon = mode === 'email' ? Mail : Link2;
  if (link) {
    return (
      <ShareLinkButton url={link} title={title} label={t(`transfers.mode.${mode}`)} withLinkIcon />
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon aria-hidden="true" className="size-4" />
      {t(`transfers.mode.${mode}`)}
    </span>
  );
}

function Expires({ transfer }: { transfer: TransferSummary }) {
  const { i18n } = useTranslation();
  if (transfer.status === 'uploading') return <span aria-hidden="true">â€”</span>;
  const iso = new Date(transfer.expiresAt * 1000).toISOString();
  return (
    <HintText content={formatDateTime(transfer.expiresAt, i18n.language)}>
      <time dateTime={iso}>{formatRelative(transfer.expiresAt, i18n.language)}</time>
    </HintText>
  );
}

export default function TransfersPage() {
  const { t, i18n } = useTranslation();
  const { params, update, page } = useUrlState();
  const { status, mode, q } = readListParams(params);
  const [search, setSearch] = useUrlSearch(q, update);

  const query = { page, pageSize: PAGE_SIZE_DEFAULT, status, mode, q: q || undefined };
  const list = useQuery({
    queryKey: queryKeys.transfers.list(query),
    queryFn: () => listTransfers(query),
    placeholderData: keepPreviousData,
  });

  const filtered = Boolean(status || mode || q);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const untitled = t('transfers.list.untitled');
  const locale = i18n.language;

  const newButton = (
    <Button asChild>
      <Link to="/">
        <Plus aria-hidden="true" />
        {t('transfers.list.new')}
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('transfers.title')}
        description={t('transfers.list.description')}
        actions={newButton}
      />

      <form
        role="search"
        aria-label={t('transfers.list.filters')}
        onSubmit={(event) => event.preventDefault()}
        className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem]"
      >
        <div className="relative sm:col-span-2 lg:col-span-1">
          <label htmlFor="transfers-search" className="sr-only">
            {t('transfers.list.search')}
          </label>
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            id="transfers-search"
            type="search"
            value={search}
            maxLength={100}
            placeholder={t('transfers.list.searchPlaceholder')}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <div>
          <label htmlFor="transfers-status" className="sr-only">
            {t('transfers.list.status')}
          </label>
          <SelectInput
            id="transfers-status"
            value={status ?? ''}
            onValueChange={(value) => update({ status: value })}
            options={[
              { value: '', label: t('transfers.list.allStatuses') },
              ...STATUS_FILTERS.map((value) => ({ value, label: t(`common.status.${value}`) })),
            ]}
          />
        </div>
        <div>
          <label htmlFor="transfers-mode" className="sr-only">
            {t('transfers.list.mode')}
          </label>
          <SelectInput
            id="transfers-mode"
            value={mode ?? ''}
            onValueChange={(value) => update({ mode: value })}
            options={[
              { value: '', label: t('transfers.list.allModes') },
              { value: 'link', label: t('transfers.mode.link') },
              { value: 'email', label: t('transfers.mode.email') },
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
          title={filtered ? t('transfers.list.noResults') : t('transfers.list.emptyTitle')}
          description={
            filtered ? t('transfers.list.noResultsHint') : t('transfers.list.emptyDescription')
          }
          action={
            filtered ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSearch('');
                  update({ q: undefined, status: undefined, mode: undefined });
                }}
              >
                {t('transfers.list.clearFilters')}
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
                <TableHead>{t('transfers.list.columns.transfer')}</TableHead>
                <TableHead>{t('transfers.list.columns.status')}</TableHead>
                <TableHead>{t('transfers.list.columns.mode')}</TableHead>
                <TableHead className="text-right">{t('transfers.list.columns.size')}</TableHead>
                <TableHead className="text-right">{t('transfers.list.columns.files')}</TableHead>
                <TableHead className="text-right">
                  {t('transfers.list.columns.downloads')}
                </TableHead>
                <TableHead>{t('transfers.list.columns.created')}</TableHead>
                <TableHead>{t('transfers.list.columns.expires')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('transfers.list.columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((transfer) => (
                <TableRow key={transfer.id}>
                  <TableCell className="max-w-64 whitespace-normal">
                    <Link
                      to={`/transfers/${transfer.id}`}
                      className="font-medium break-words underline-offset-4 hover:underline"
                    >
                      {transferTitle(transfer, untitled)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={transfer.status} />
                  </TableCell>
                  <TableCell>
                    <ModeLabel
                      mode={transfer.mode}
                      link={transfer.status === 'active' ? transfer.shareUrl : null}
                      title={transferTitle(transfer, untitled)}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {formatBytes(transfer.totalBytes, locale)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {transfer.fileCount}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {downloadsText(transfer)}
                  </TableCell>
                  <TableCell>{formatDateTime(transfer.createdAt, locale)}</TableCell>
                  <TableCell>
                    <Expires transfer={transfer} />
                  </TableCell>
                  <TableCell>
                    <TransferActionsMenu transfer={transfer} fallbackTitle={untitled} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <ul className="space-y-3 md:hidden">
            {list.data.items.map((transfer) => (
              <li key={transfer.id} className="flex items-start gap-2">
                <Link
                  to={`/transfers/${transfer.id}`}
                  className="border-border hover:bg-muted/50 block min-w-0 flex-1 space-y-2 border p-4"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 font-medium break-words">
                      {transferTitle(transfer, untitled)}
                    </span>
                    <StatusBadge status={transfer.status} />
                  </span>
                  <span className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <ModeLabel
                      mode={transfer.mode}
                      link={transfer.status === 'active' ? transfer.shareUrl : null}
                      title={transferTitle(transfer, untitled)}
                    />
                    <span className="font-mono text-xs">
                      {formatBytes(transfer.totalBytes, locale)} Â·{' '}
                      {t('common.units.files', { count: transfer.fileCount })}
                    </span>
                  </span>
                  <span className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>
                      {t('transfers.list.columns.downloads')}:{' '}
                      <span className="font-mono">{downloadsText(transfer)}</span>
                    </span>
                    <span>
                      {t('transfers.list.columns.expires')}: <Expires transfer={transfer} />
                    </span>
                  </span>
                </Link>
                <TransferActionsMenu transfer={transfer} fallbackTitle={untitled} />
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
    </>
  );
}
