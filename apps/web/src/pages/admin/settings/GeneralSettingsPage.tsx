import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState, LoadingState } from '@/components/common/States';
import { getAdminSettings } from '@/lib/api/settings';
import { GeneralSection } from './GeneralSection';

export default function GeneralSettingsPage() {
  const { t } = useTranslation();
  const settings = useQuery({ queryKey: queryKeys.admin.settings, queryFn: getAdminSettings });
  return (
    <>
      <PageHeader
        title={t('admin.settings.general.title')}
        description={t('admin.settings.general.description')}
      />
      {settings.isPending ? (
        <LoadingState variant="skeleton" lines={3} />
      ) : settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <GeneralSection settings={settings.data.general} />
      )}
    </>
  );
}
