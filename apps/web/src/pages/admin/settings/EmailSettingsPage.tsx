import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState, LoadingState } from '@/components/common/States';
import { getAdminSettings } from '@/lib/api/settings';
import { SmtpSection } from './SmtpSection';

export default function EmailSettingsPage() {
  const { t } = useTranslation();
  const settings = useQuery({ queryKey: queryKeys.admin.settings, queryFn: getAdminSettings });
  return (
    <>
      <PageHeader
        title={t('admin.settings.smtp.title')}
        description={t('admin.settings.smtp.description')}
      />
      {settings.isPending ? (
        <LoadingState variant="skeleton" lines={4} />
      ) : settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <SmtpSection smtp={settings.data.smtp} />
      )}
    </>
  );
}
