import type {
  StorageDriverKind,
  StorageMigration,
  StorageSettingsResponse,
} from '@easysend/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  cancelStorageMigration,
  getStorageMigration,
  startStorageMigration,
} from '@/lib/api/storage';
import { errorMessage } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { notifyError } from '@/lib/toast';

/** How often the status is polled while a migration is active. */
export const MIGRATION_POLL_MS = 2000;

const isActive = (migration: StorageMigration | null | undefined) =>
  migration?.status === 'running' || migration?.status === 'cancelling';

function percentOf(migration: StorageMigration): number {
  if (migration.totalBytes > 0) {
    return Math.min(100, Math.round((migration.doneBytes / migration.totalBytes) * 100));
  }
  if (migration.totalFiles > 0) {
    return Math.min(100, Math.round((migration.doneFiles / migration.totalFiles) * 100));
  }
  return 0;
}

/**
 * Moves the files that are on the other storage to the one in use. Polls the status every 2 s
 * while a migration is running, shows its progress and, once finished, its outcome.
 */
export function MigrationCard({ settings }: { settings: StorageSettingsResponse }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const locale = i18n.language;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const query = useQuery({
    queryKey: queryKeys.admin.storageMigration,
    queryFn: getStorageMigration,
    refetchInterval: (q) => (isActive(q.state.data?.migration) ? MIGRATION_POLL_MS : false),
  });
  const migration = query.data?.migration ?? null;
  const active = isActive(migration);

  // When a migration ends, the usage figures and the locked fields change.
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active) {
      // The prefix covers the Space page, the storage settings and the migration itself.
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.storage });
    }
    wasActive.current = active;
  }, [active, queryClient]);

  const target: StorageDriverKind = settings.driver;
  const source: StorageDriverKind = target === 'local' ? 's3' : 'local';
  const pending = settings.usage[source];
  const targetMissing = target === 's3' && settings.s3 === null;
  const targetName = t(`admin.settings.storage.migration.targets.${target}`);

  const start = useMutation({
    mutationFn: () => startStorageMigration(target),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.admin.storageMigration, response);
    },
    onError: (error) => notifyError(errorMessage(t, error)),
  });
  const cancel = useMutation({
    mutationFn: cancelStorageMigration,
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.admin.storageMigration, response);
      titleRef.current?.focus();
    },
    onError: (error) => notifyError(errorMessage(t, error)),
  });

  const filesText = (count: number) => t('admin.settings.storage.usage.files', { count });

  return (
    <section
      aria-labelledby="storage-migration"
      className="ring-foreground/10 max-w-xl space-y-4 p-4 ring-1"
    >
      <h2
        id="storage-migration"
        ref={titleRef}
        tabIndex={-1}
        className="text-lg font-semibold outline-none"
      >
        {t('admin.settings.storage.migration.title')}
      </h2>

      {active && migration ? (
        <div className="space-y-3" data-testid="migration-progress">
          <p className="text-sm font-medium">
            {t('admin.settings.storage.migration.progressTitle', {
              target: t(`admin.settings.storage.migration.targets.${migration.target}`),
            })}
          </p>
          <Progress
            value={percentOf(migration)}
            aria-label={t('admin.settings.storage.migration.progressLabel')}
            aria-valuetext={`${percentOf(migration)}%`}
          />
          <p role="status" aria-live="polite" className="font-mono text-sm">
            {migration.status === 'cancelling'
              ? t('admin.settings.storage.migration.cancelling')
              : t('admin.settings.storage.migration.progressText', {
                  done: migration.doneFiles.toLocaleString(locale),
                  total: migration.totalFiles.toLocaleString(locale),
                  doneSize: formatBytes(migration.doneBytes, locale),
                  totalSize: formatBytes(migration.totalBytes, locale),
                })}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={migration.status === 'cancelling' || cancel.isPending}
            aria-busy={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {t('admin.settings.storage.migration.cancel')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.files > 0 ? (
            <>
              <p className="text-sm">
                {t('admin.settings.storage.migration.intro', {
                  context: target,
                  files: filesText(pending.files),
                  size: formatBytes(pending.bytes, locale),
                })}
              </p>
              {targetMissing ? (
                <p className="text-muted-foreground text-sm">
                  {t('admin.settings.storage.migration.targetMissing')}
                </p>
              ) : null}
              <Button
                type="button"
                disabled={targetMissing || start.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                {t('admin.settings.storage.migration.start', {
                  context: target,
                  files: filesText(pending.files),
                  size: formatBytes(pending.bytes, locale),
                })}
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t('admin.settings.storage.migration.none')}
            </p>
          )}
        </div>
      )}

      {migration && !active ? <Outcome migration={migration} locale={locale} /> : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('admin.settings.storage.migration.confirmTitle', { context: target })}
        description={t('admin.settings.storage.migration.confirmBody', { target: targetName })}
        confirmLabel={t('admin.settings.storage.migration.confirm')}
        onConfirm={() => start.mutateAsync()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
      />
    </section>
  );
}

/** Result of the last finished migration, with a translated error code when it failed. */
function Outcome({ migration, locale }: { migration: StorageMigration; locale: string }) {
  const { t } = useTranslation();
  const target = t(`admin.settings.storage.migration.targets.${migration.target}`);
  const files = (count: number) => t('admin.settings.storage.usage.files', { count });
  if (migration.status === 'done') {
    return (
      <Alert>
        <AlertDescription>
          {t('admin.settings.storage.migration.outcomeDone', {
            files: files(migration.doneFiles),
            target,
          })}
        </AlertDescription>
      </Alert>
    );
  }
  if (migration.status === 'cancelled') {
    return (
      <Alert>
        <AlertDescription>
          {t('admin.settings.storage.migration.outcomeCancelled', {
            done: migration.doneFiles.toLocaleString(locale),
            total: migration.totalFiles.toLocaleString(locale),
          })}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>{t('admin.settings.storage.migration.outcomeFailed')}</AlertTitle>
      <AlertDescription>
        {migration.errorCode ? (
          <p>{t(`errors.${migration.errorCode}`, { defaultValue: t('errors.generic') })}</p>
        ) : null}
        {migration.failedFiles > 0 ? (
          <p>
            {t('admin.settings.storage.migration.failedFiles', { count: migration.failedFiles })}
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
