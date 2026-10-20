import { USER_ROLES, type AdminUser, type UserRole } from '@easysend/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, ShieldCheck, ShieldOff, Trash2, UserPlus, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/app/providers/SessionProvider';
import { queryKeys } from '@/app/query';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { listUsers, resetUser2fa } from '@/lib/api/admin';
import { errorMessage } from '@/lib/errors';
import { formatRelative } from '@/lib/format';
import { notifyError, notifySuccess } from '@/lib/toast';
import {
  DataBody,
  DataCell,
  DataHead,
  DataHeadCell,
  DataRow,
  DataTable,
} from './components/DataTable';
import { NativeSelect } from './components/NativeSelect';
import { Pager } from './components/Pager';
import { UsageMeter } from './components/UsageMeter';
import { useDebouncedValue, useUrlState } from './components/useUrlState';
import { CreateUserDialog, DeleteUserDialog, EditUserDialog } from './users/UserDialogs';

const PAGE_SIZE = 20;

function parseRole(value: string | null): UserRole | undefined {
  return USER_ROLES.find((role) => role === value);
}

export default function UsersPage() {
  const { t, i18n } = useTranslation();
  const { user: me } = useSession();
  const queryClient = useQueryClient();
  const { params, update, page } = useUrlState();

  const q = params.get('q') ?? '';
  const role = parseRole(params.get('role'));

  const [search, setSearch] = useState(q);
  const debouncedSearch = useDebouncedValue(search.trim());
  useEffect(() => {
    if (debouncedSearch !== q) update({ q: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the typed value
  }, [debouncedSearch]);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    ...(q ? { q } : {}),
    ...(role ? { role } : {}),
  };
  const users = useQuery({
    queryKey: queryKeys.admin.users(query),
    queryFn: () => listUsers(query),
    placeholderData: (previous) => previous,
  });

  const reset2fa = useMutation({
    mutationFn: (target: AdminUser) => resetUser2fa(target.id),
    onSuccess: async (_data, target) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      notifySuccess(t('admin.users.reset2fa.doneToast', { email: target.email }));
    },
    onError: (error) => notifyError(errorMessage(t, error)),
  });

  const filtered = q !== '' || role !== undefined;

  return (
    <>
      <PageHeader
        title={t('admin.usersTitle')}
        description={t('admin.users.description')}
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <UserPlus aria-hidden="true" />
            {t('admin.users.create.open')}
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_12rem]" role="search">
        <div className="space-y-1.5">
          <Label htmlFor="users-search" className="text-sm font-medium">
            {t('admin.users.filters.search')}
          </Label>
          <Input
            id="users-search"
            type="search"
            autoComplete="off"
            placeholder={t('admin.users.filters.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="users-role" className="text-sm font-medium">
            {t('admin.users.filters.role')}
          </Label>
          <NativeSelect
            id="users-role"
            value={role ?? ''}
            onChange={(event) => update({ role: event.target.value })}
          >
            <option value="">{t('admin.users.filters.allRoles')}</option>
            {USER_ROLES.map((value) => (
              <option key={value} value={value}>
                {t(`admin.users.roles.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {users.isPending ? (
        <LoadingState variant="skeleton" lines={5} />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : users.data.items.length === 0 ? (
        <EmptyState
          title={filtered ? t('admin.users.emptyFiltered') : t('admin.users.empty')}
          action={
            filtered ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSearch('');
                  update({ q: undefined, role: undefined });
                }}
              >
                {t('admin.users.filters.clear')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4" aria-busy={users.isFetching}>
          <DataTable aria-label={t('admin.usersTitle')}>
            <DataHead>
              <DataRow>
                <DataHeadCell>{t('admin.users.columns.user')}</DataHeadCell>
                <DataHeadCell>{t('admin.users.columns.role')}</DataHeadCell>
                <DataHeadCell>{t('admin.users.columns.twoFactor')}</DataHeadCell>
                <DataHeadCell>{t('admin.users.columns.usage')}</DataHeadCell>
                <DataHeadCell>{t('admin.users.columns.transfers')}</DataHeadCell>
                <DataHeadCell>{t('admin.users.columns.lastLogin')}</DataHeadCell>
                <DataHeadCell>
                  <span className="sr-only">{t('admin.users.columns.actions')}</span>
                </DataHeadCell>
              </DataRow>
            </DataHead>
            <DataBody>
              {users.data.items.map((user) => {
                const isSelf = user.id === me?.id;
                return (
                  <DataRow key={user.id}>
                    <DataCell label={t('admin.users.columns.user')}>
                      <div className="min-w-0 text-right break-words lg:text-left">
                        <p className="font-medium break-all">{user.email}</p>
                        {user.displayName ? (
                          <p className="text-muted-foreground text-xs">{user.displayName}</p>
                        ) : null}
                        {user.disabled ? (
                          <Badge variant="destructive" className="mt-1">
                            {t('admin.users.disabled')}
                          </Badge>
                        ) : null}
                      </div>
                    </DataCell>
                    <DataCell label={t('admin.users.columns.role')}>
                      <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                        {t(`admin.users.roles.${user.role}`)}
                      </Badge>
                    </DataCell>
                    <DataCell label={t('admin.users.columns.twoFactor')}>
                      <span className="inline-flex items-center gap-1.5">
                        {user.totpEnabled ? (
                          <ShieldCheck aria-hidden="true" className="size-4" />
                        ) : (
                          <ShieldOff aria-hidden="true" className="size-4" />
                        )}
                        {user.totpEnabled
                          ? t('admin.users.twoFactor.on')
                          : t('admin.users.twoFactor.off')}
                      </span>
                    </DataCell>
                    <DataCell label={t('admin.users.columns.usage')}>
                      <UsageMeter
                        usedBytes={user.usedBytes}
                        quotaBytes={user.quotaBytes}
                        label={user.email}
                      />
                    </DataCell>
                    <DataCell label={t('admin.users.columns.transfers')}>
                      <span className="font-mono">{user.transferCount}</span>
                    </DataCell>
                    <DataCell label={t('admin.users.columns.lastLogin')}>
                      {user.lastLoginAt !== null
                        ? formatRelative(user.lastLoginAt, i18n.language)
                        : t('admin.users.never')}
                    </DataCell>
                    <DataCell>
                      <div className="flex flex-wrap gap-2 max-lg:w-full max-lg:justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={t('admin.users.actions.edit', { email: user.email })}
                          onClick={() => setEditing(user)}
                        >
                          <Pencil aria-hidden="true" />
                          {t('common.actions.edit')}
                        </Button>
                        {user.totpEnabled ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={t('admin.users.actions.reset2fa', { email: user.email })}
                            onClick={() => setResetting(user)}
                          >
                            <KeyRound aria-hidden="true" />
                            {t('admin.users.reset2fa.action')}
                          </Button>
                        ) : null}
                        {isSelf ? null : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={t('admin.users.actions.delete', { email: user.email })}
                            onClick={() => setDeleting(user)}
                          >
                            <Trash2 aria-hidden="true" />
                            {t('common.actions.delete')}
                          </Button>
                        )}
                      </div>
                    </DataCell>
                  </DataRow>
                );
              })}
            </DataBody>
          </DataTable>
          <Pager
            page={users.data.page}
            pageSize={users.data.pageSize}
            total={users.data.total}
            onPageChange={(next) => update({ page: String(next) })}
          />
        </div>
      )}

      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <EditUserDialog
        open={editing !== null}
        user={editing}
        currentUserId={me?.id}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <DeleteUserDialog
        open={deleting !== null}
        user={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
      <ConfirmDialog
        open={resetting !== null}
        onOpenChange={(open) => {
          if (!open) setResetting(null);
        }}
        title={t('admin.users.reset2fa.title')}
        description={
          resetting?.role === 'admin'
            ? t('admin.users.reset2fa.descriptionAdmin', { email: resetting.email })
            : t('admin.users.reset2fa.descriptionUser', { email: resetting?.email ?? '' })
        }
        confirmLabel={t('admin.users.reset2fa.confirm')}
        destructive
        onConfirm={async () => {
          if (resetting) await reset2fa.mutateAsync(resetting);
        }}
      />
    </>
  );
}
