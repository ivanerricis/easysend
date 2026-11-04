import type { StorageSettingsResponse } from '@easysend/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState, LoadingState } from '@/components/common/States';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getStorageSettings, saveStorage, testStorage } from '@/lib/api/settings';
import { formatBytes } from '@/lib/format';
import { notifySuccess } from '@/lib/toast';
import { StorageForm } from '../../settings-forms/StorageForm';
import { MigrationCard } from './MigrationCard';

export default function StorageSettingsPage() {
  const { t } = useTranslation();
  const settings = useQuery({
    queryKey: queryKeys.admin.storageSettings,
    queryFn: getStorageSettings,
  });
  return (
    <>
      <PageHeader
        title={t('admin.settings.storage.title')}
        description={t('admin.settings.storage.description')}
      />
      {settings.isPending ? (
        <LoadingState variant="skeleton" lines={4} />
      ) : settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <StorageSettings settings={settings.data} />
      )}
    </>
  );
}

function StorageSettings({ settings }: { settings: StorageSettingsResponse }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return (
    <div className="space-y-8">
      {settings.envDiffers ? (
        <Alert className="max-w-xl">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>{t('admin.settings.storage.envDiffers.title')}</AlertTitle>
          <AlertDescription>{t('admin.settings.storage.envDiffers.body')}</AlertDescription>
        </Alert>
      ) : null}

      <StorageForm
        settings={settings}
        idPrefix="storage"
        test={testStorage}
        save={saveStorage}
        actionsClassName="flex flex-wrap gap-3"
        onSaved={async (response) => {
          queryClient.setQueryData(queryKeys.admin.storageSettings, response);
          await queryClient.invalidateQueries({ queryKey: queryKeys.admin.storage });
          notifySuccess(t('admin.settings.savedToast'));
        }}
      />

      <UsageSection settings={settings} />
      <MigrationCard settings={settings} />
    </div>
  );
}

/** Files and bytes per storage, with the one used for new files marked in words. */
function UsageSection({ settings }: { settings: StorageSettingsResponse }) {
  const { t, i18n } = useTranslation();
  return (
    <section aria-labelledby="storage-usage" className="max-w-xl space-y-3">
      <h2 id="storage-usage" className="text-lg font-semibold">
        {t('admin.settings.storage.usage.title')}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-2">
        {(['local', 's3'] as const).map((driver) => (
          <div key={driver} className="ring-foreground/10 space-y-1 p-4 ring-1">
            <dt className="text-sm font-medium">
              {t(`admin.settings.storage.usage.${driver}`)}
              {settings.driver === driver ? (
                <span className="text-muted-foreground block text-xs font-normal">
                  {t('admin.settings.storage.usage.active')}
                </span>
              ) : null}
            </dt>
            <dd className="font-mono text-sm">
              {t('admin.settings.storage.usage.files', { count: settings.usage[driver].files })}
              {', '}
              {formatBytes(settings.usage[driver].bytes, i18n.language)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
