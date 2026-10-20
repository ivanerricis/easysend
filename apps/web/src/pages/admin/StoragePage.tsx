import type { StorageResponse } from '@easysend/shared';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States';
import { Button } from '@/components/ui/button';
import { getStorage } from '@/lib/api/admin';
import { formatBytes, formatDateTime } from '@/lib/format';
import {
  DataBody,
  DataCell,
  DataHead,
  DataHeadCell,
  DataRow,
  DataTable,
} from './components/DataTable';
import { UsageMeter } from './components/UsageMeter';

type SegmentId = 'others' | 'stored' | 'reserve' | 'usable';

interface Segment {
  id: SegmentId;
  bytes: number;
}

/** Splits the disk into the four parts of the bar; they always add up to the total. */
function diskSegments(disk: StorageResponse['disk'], storedBytes: number): Segment[] {
  const total = Math.max(disk.totalBytes, 1);
  const free = Math.min(disk.freeBytes, total);
  const stored = Math.min(storedBytes, Math.max(0, total - free));
  const others = Math.max(0, total - free - stored);
  const reserve = Math.min(disk.reserveBytes, free);
  const usable = Math.max(0, free - reserve);
  return [
    { id: 'others', bytes: others },
    { id: 'stored', bytes: stored },
    { id: 'reserve', bytes: reserve },
    { id: 'usable', bytes: usable },
  ];
}

// Swatches combine colour with a shape/texture, so the meaning never relies on colour alone.
const SWATCH_CLASS: Record<SegmentId, string> = {
  others: 'bg-muted-foreground',
  stored: 'bg-accent',
  reserve: 'text-muted-foreground bg-muted border border-current',
  usable: 'bg-background border border-foreground',
};
const HATCH: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 7px)',
};

function Swatch({ id }: { id: SegmentId }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-3.5 shrink-0 ${SWATCH_CLASS[id]}`}
      style={id === 'reserve' ? HATCH : undefined}
    />
  );
}

export default function StoragePage() {
  const { t, i18n } = useTranslation();
  const storage = useQuery({ queryKey: queryKeys.admin.storage, queryFn: getStorage });

  return (
    <>
      <PageHeader
        title={t('admin.storageTitle')}
        description={t('admin.storage.description')}
        actions={
          <Button
            type="button"
            variant="outline"
            disabled={storage.isFetching}
            onClick={() => void storage.refetch()}
          >
            <RefreshCw
              aria-hidden="true"
              className={storage.isFetching ? 'motion-safe:animate-spin' : undefined}
            />
            {t('common.actions.refresh')}
          </Button>
        }
      />

      {storage.isPending ? (
        <LoadingState variant="skeleton" lines={5} />
      ) : storage.isError ? (
        <ErrorState error={storage.error} onRetry={() => void storage.refetch()} />
      ) : (
        <StorageContent
          data={storage.data}
          updatedAt={storage.dataUpdatedAt}
          locale={i18n.language}
        >
          <p className="sr-only" role="status">
            {storage.isFetching ? t('admin.storage.refreshing') : t('admin.storage.refreshed')}
          </p>
        </StorageContent>
      )}
    </>
  );
}

function StorageContent({
  data,
  updatedAt,
  locale,
  children,
}: {
  data: StorageResponse;
  updatedAt: number;
  locale: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const total = Math.max(data.disk.totalBytes, 1);
  const segments = diskSegments(data.disk, data.storedBytes);
  const percent = (bytes: number) => Math.round((bytes / total) * 1000) / 10;
  const summary = segments
    .map(
      (segment) =>
        `${t(`admin.storage.segments.${segment.id}`)}: ${formatBytes(segment.bytes, locale)}`,
    )
    .join(', ');
  const users = [...data.users].sort((a, b) => b.usedBytes - a.usedBytes);

  return (
    <div className="space-y-8">
      {children}
      <section aria-labelledby="storage-disk" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="storage-disk" className="text-lg font-semibold">
            {t('admin.storage.diskTitle')}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t('admin.storage.total')}:{' '}
            <span className="text-foreground font-mono">
              {formatBytes(data.disk.totalBytes, locale)}
            </span>
          </p>
        </div>

        <div
          role="img"
          aria-label={`${t('admin.storage.barLabel', { total: formatBytes(data.disk.totalBytes, locale) })} ${summary}`}
          className="flex h-6 w-full gap-0.5"
        >
          {segments
            .filter((segment) => segment.bytes > 0)
            .map((segment) => (
              <div
                key={segment.id}
                className={`h-full min-w-0.5 ${SWATCH_CLASS[segment.id]}`}
                style={{
                  width: `${percent(segment.bytes)}%`,
                  ...(segment.id === 'reserve' ? HATCH : {}),
                }}
              />
            ))}
        </div>

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {segments.map((segment) => (
            <div key={segment.id} className="space-y-0.5">
              <dt className="flex items-center gap-2 text-sm">
                <Swatch id={segment.id} />
                {t(`admin.storage.segments.${segment.id}`)}
              </dt>
              <dd className="pl-[calc(0.875rem+0.5rem)]">
                <span className="font-mono text-base font-medium">
                  {formatBytes(segment.bytes, locale)}
                </span>{' '}
                <span className="text-muted-foreground font-mono text-xs">
                  ({percent(segment.bytes).toLocaleString(locale)}%)
                </span>
                <span className="text-muted-foreground block text-xs">
                  {t(`admin.storage.segmentHelp.${segment.id}`)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground text-xs">
          {t('admin.storage.freeNote', {
            free: formatBytes(data.disk.freeBytes, locale),
            reserve: formatBytes(data.disk.reserveBytes, locale),
          })}
        </p>
      </section>

      <section aria-labelledby="storage-numbers" className="space-y-3">
        <h2 id="storage-numbers" className="text-lg font-semibold">
          {t('admin.storage.numbersTitle')}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          {[
            [t('admin.storage.storedBytes'), formatBytes(data.storedBytes, locale)],
            [t('admin.storage.activeTransfers'), data.activeTransfers.toLocaleString(locale)],
            [t('admin.storage.totalFiles'), data.totalFiles.toLocaleString(locale)],
          ].map(([label, value]) => (
            <div key={label} className="ring-foreground/10 space-y-1 p-4 ring-1">
              <dt className="text-muted-foreground text-sm">{label}</dt>
              <dd className="font-mono text-2xl font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="storage-users" className="space-y-3">
        <h2 id="storage-users" className="text-lg font-semibold">
          {t('admin.storage.usersTitle')}
        </h2>
        {users.length === 0 ? (
          <EmptyState title={t('admin.storage.noUsers')} />
        ) : (
          <DataTable aria-labelledby="storage-users">
            <DataHead>
              <DataRow>
                <DataHeadCell>{t('admin.storage.columns.user')}</DataHeadCell>
                <DataHeadCell>{t('admin.storage.columns.usage')}</DataHeadCell>
              </DataRow>
            </DataHead>
            <DataBody>
              {users.map((user) => (
                <DataRow key={user.userId}>
                  <DataCell label={t('admin.storage.columns.user')}>
                    <span className="font-medium break-all">{user.email}</span>
                  </DataCell>
                  <DataCell label={t('admin.storage.columns.usage')}>
                    <UsageMeter
                      usedBytes={user.usedBytes}
                      quotaBytes={user.quotaBytes}
                      label={user.email}
                      className="lg:max-w-xs"
                    />
                  </DataCell>
                </DataRow>
              ))}
            </DataBody>
          </DataTable>
        )}
      </section>

      <p className="text-muted-foreground text-xs">
        {t('admin.storage.updatedAt', {
          time: formatDateTime(Math.floor(updatedAt / 1000), locale),
        })}
      </p>
    </div>
  );
}
