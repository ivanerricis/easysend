import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState, LoadingState } from '@/components/common/States';
import { getTunnel } from '@/lib/api/admin';
import { TunnelSection } from './TunnelSection';

export default function CloudflareSettingsPage() {
  const { t } = useTranslation();
  const tunnel = useQuery({ queryKey: queryKeys.admin.tunnel, queryFn: getTunnel });
  return (
    <>
      <PageHeader
        title={t('admin.settings.tunnel.title')}
        description={t('admin.settings.tunnel.description')}
      />
      {tunnel.isPending ? (
        <LoadingState variant="skeleton" lines={3} />
      ) : tunnel.isError ? (
        <ErrorState error={tunnel.error} onRetry={() => void tunnel.refetch()} />
      ) : (
        <TunnelSection tunnel={tunnel.data} />
      )}
    </>
  );
}
