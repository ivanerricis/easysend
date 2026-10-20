import { TRANSFER_MODES, TRANSFER_STATUSES } from '@easysend/shared';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { queryKeys } from '@/app/query';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { listUsers } from '@/lib/api/admin';
import { adminListTransfers } from '@/lib/api/transfers';
import { formatBytes, formatDateTime } from '@/lib/format';
import {
  DataBody,
  DataCell,
  DataHead,
  DataHeadCell,
  DataRow,
  DataTable,
} from './components/DataTable';
import { SelectInput } from '@/components/common/SelectInput';
import { Pager } from './components/Pager';
import { useDebouncedValue, useUrlState } from './components/useUrlState';

const PAGE_SIZE = 20;

export default function AdminTransfersPage() {
  const { t, i18n } = useTranslation();
  const { params, update, page } = useUrlState();

  const q = params.get('q') ?? '';
  const status = TRANSFER_STATUSES.find((value) => value === params.get('status'));
  const mode = TRANSFER_MODES.find((value) => value === params.get('mode'));
  const ownerId = params.get('owner') ?? '';

  const [search, setSearch] = useState(q);
  const debouncedSearch = useDebouncedValue(search.trim());
  useEffect(() => {
    if (debouncedSearch !== q) update({ q: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the typed value
  }, [debouncedSearch]);

  const owners = useQuery({
    queryKey: queryKeys.admin.users({ pageSize: 100, purpose: 'owners' }),
    queryFn: () => listUsers({ pageSize: 100 }),
  });

  const query = {
    page,
    pageSize: PAGE_SIZE,
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(mode ? { mode } : {}),
    ...(ownerId ? { ownerId } : {}),
  };
  const transfers = useQuery({
    queryKey: queryKeys.admin.transfers(query),
    queryFn: () => adminListTransfers(query),
    placeholderData: (previous) => previous,
  });

  const filtered = q !== '' || status !== undefined || mode !== undefined || ownerId !== '';

  return (
    <>
      <PageHeader
        title={t('admin.transfersTitle')}
        description={t('admin.transfers.description')}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
          <Label htmlFor="transfers-search" className="text-sm font-medium">
            {t('admin.transfers.filters.search')}
          </Label>
          <Input
            id="transfers-search"
            type="search"
            autoComplete="off"
            placeholder={t('admin.transfers.filters.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="transfers-status" className="text-sm font-medium">
            {t('admin.transfers.filters.status')}
          </Label>
          <SelectInput
            id="transfers-status"
            value={status ?? ''}
            onValueChange={(value) => update({ status: value })}
            options={[
              { value: '', label: t('admin.transfers.filters.allStatuses') },
              ...TRANSFER_STATUSES.map((value) => ({ value, label: t(`common.status.${value}`) })),
            ]}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="transfers-mode" className="text-sm font-medium">
            {t('admin.transfers.filters.mode')}
          </Label>
          <SelectInput
            id="transfers-mode"
            value={mode ?? ''}
            onValueChange={(value) => update({ mode: value })}
            options={[
              { value: '', label: t('admin.transfers.filters.allModes') },
              ...TRANSFER_MODES.map((value) => ({
                value,
                label: t(`admin.transfers.modes.${value}`),
              })),
            ]}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="transfers-owner" className="text-sm font-medium">
            {t('admin.transfers.filters.owner')}
          </Label>
          <SelectInput
            id="transfers-owner"
            value={ownerId}
            onValueChange={(value) => update({ owner: value })}
            options={[
              { value: '', label: t('admin.transfers.filters.allOwners') },
              ...(ownerId && !owners.data?.items.some((owner) => owner.id === ownerId)
                ? [{ value: ownerId, label: ownerId }]
                : []),
              ...(owners.data?.items ?? []).map((owner) => ({
                value: owner.id,
                label: owner.email,
              })),
            ]}
          />
        </div>
      </div>

      {transfers.isPending ? (
        <LoadingState variant="skeleton" lines={5} />
      ) : transfers.isError ? (
        <ErrorState error={transfers.error} onRetry={() => void transfers.refetch()} />
      ) : transfers.data.items.length === 0 ? (
        <EmptyState
          title={filtered ? t('admin.transfers.emptyFiltered') : t('admin.transfers.empty')}
          action={
            filtered ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSearch('');
                  update({ q: undefined, status: undefined, mode: undefined, owner: undefined });
                }}
              >
                {t('admin.transfers.filters.clear')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4" aria-busy={transfers.isFetching}>
          <DataTable aria-label={t('admin.transfersTitle')}>
            <DataHead>
              <DataRow>
                <DataHeadCell>{t('admin.transfers.columns.transfer')}</DataHeadCell>
                <DataHeadCell>{t('admin.transfers.columns.owner')}</DataHeadCell>
                <DataHeadCell>{t('admin.transfers.columns.status')}</DataHeadCell>
                <DataHeadCell>{t('admin.transfers.columns.content')}</DataHeadCell>
                <DataHeadCell>{t('admin.transfers.columns.downloads')}</DataHeadCell>
                <DataHeadCell>{t('admin.transfers.columns.expires')}</DataHeadCell>
              </DataRow>
            </DataHead>
            <DataBody>
              {transfers.data.items.map((item) => (
                <DataRow key={item.id}>
                  <DataCell label={t('admin.transfers.columns.transfer')}>
                    <div className="min-w-0 text-right lg:text-left">
                      <Link
                        to={`/transfers/${item.id}`}
                        className="font-medium break-words underline underline-offset-4"
                      >
                        {item.title ?? t('admin.transfers.untitled')}
                      </Link>
                      <p className="text-muted-foreground flex items-center justify-end gap-1.5 text-xs lg:justify-start">
                        {t(`admin.transfers.modes.${item.mode}`)}
                        {item.mode === 'email'
                          ? ` · ${t('common.units.recipients', { count: item.recipientCount })}`
                          : ''}
                        {item.hasPassword ? (
                          <>
                            <Lock aria-hidden="true" className="size-3" />
                            <span>{t('admin.transfers.passwordProtected')}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </DataCell>
                  <DataCell label={t('admin.transfers.columns.owner')}>
                    <span className="break-all">{item.ownerEmail}</span>
                  </DataCell>
                  <DataCell label={t('admin.transfers.columns.status')}>
                    <StatusBadge status={item.status} />
                  </DataCell>
                  <DataCell label={t('admin.transfers.columns.content')}>
                    <span className="font-mono text-xs">
                      {t('common.units.files', { count: item.fileCount })} ·{' '}
                      {formatBytes(item.totalBytes, i18n.language)}
                    </span>
                  </DataCell>
                  <DataCell label={t('admin.transfers.columns.downloads')}>
                    <span className="font-mono">
                      {item.maxDownloads === null
                        ? item.downloadCount
                        : `${item.downloadCount} / ${item.maxDownloads}`}
                    </span>
                  </DataCell>
                  <DataCell label={t('admin.transfers.columns.expires')}>
                    {formatDateTime(item.expiresAt, i18n.language)}
                  </DataCell>
                </DataRow>
              ))}
            </DataBody>
          </DataTable>
          <Pager
            page={transfers.data.page}
            pageSize={transfers.data.pageSize}
            total={transfers.data.total}
            onPageChange={(next) => update({ page: String(next) })}
          />
        </div>
      )}
    </>
  );
}
