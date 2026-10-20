import { PAGE_SIZE_DEFAULT } from '@easysend/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { ErrorState, LoadingState } from '@/components/common/States';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listTransferDownloads } from '@/lib/api/transfers';
import { formatBytes, formatDateTime } from '@/lib/format';

const UA_MAX = 60;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Paginated download log of a transfer. */
export function DownloadLog({ transferId }: { transferId: string }) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const query = { page, pageSize: PAGE_SIZE_DEFAULT };
  const log = useQuery({
    queryKey: queryKeys.transfers.downloads(transferId, query),
    queryFn: () => listTransferDownloads(transferId, query),
    placeholderData: keepPreviousData,
  });
  const locale = i18n.language;

  if (log.isPending) return <LoadingState variant="skeleton" lines={3} />;
  if (log.isError) return <ErrorState error={log.error} onRetry={() => void log.refetch()} />;
  const { items, total, pageSize } = log.data;
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('transfers.detail.noDownloads')}</p>;
  }
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const target = (entry: (typeof items)[number]) =>
    entry.fileName ?? t('transfers.detail.zipArchive');

  return (
    <div className="space-y-4">
      <Table className="hidden md:table">
        <TableHeader>
          <TableRow>
            <TableHead>{t('transfers.detail.log.date')}</TableHead>
            <TableHead>{t('transfers.detail.log.target')}</TableHead>
            <TableHead className="text-right">{t('transfers.detail.log.bytes')}</TableHead>
            <TableHead>{t('transfers.detail.log.userAgent')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>{formatDateTime(entry.createdAt, locale)}</TableCell>
              <TableCell className="whitespace-normal break-all">{target(entry)}</TableCell>
              <TableCell className="text-right font-mono text-xs">
                {formatBytes(entry.bytesSent, locale)}
              </TableCell>
              <TableCell className="max-w-64 truncate" title={entry.userAgent ?? undefined}>
                {entry.userAgent ? truncate(entry.userAgent, UA_MAX) : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ul className="space-y-3 md:hidden">
        {items.map((entry) => (
          <li key={entry.id} className="border-border space-y-1 border p-3 text-sm">
            <p className="font-medium break-all">{target(entry)}</p>
            <p className="text-muted-foreground text-xs">
              {formatDateTime(entry.createdAt, locale)} ·{' '}
              <span className="font-mono">{formatBytes(entry.bytesSent, locale)}</span>
            </p>
            {entry.userAgent ? (
              <p className="text-muted-foreground text-xs break-all">
                {truncate(entry.userAgent, UA_MAX)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {pages > 1 ? (
        <nav
          aria-label={t('common.pagination.label')}
          className="flex items-center justify-center gap-2"
        >
          <Button
            type="button"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('common.pagination.previous')}
          </Button>
          <span className="px-2 text-sm" aria-current="page">
            {t('common.pagination.pageOf', { page, pages })}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t('common.pagination.next')}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
