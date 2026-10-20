import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState, LoadingState } from '@/components/common/States';
import { getTunnel } from '@/lib/api/admin';
import { getAdminSettings } from '@/lib/api/settings';
import { GeneralSection } from './settings/GeneralSection';
import { SmtpSection } from './settings/SmtpSection';
import { TunnelSection } from './settings/TunnelSection';

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4 border-t pt-6 first:border-t-0 first:pt-0">
      <div className="space-y-1">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const settings = useQuery({ queryKey: queryKeys.admin.settings, queryFn: getAdminSettings });
  const tunnel = useQuery({ queryKey: queryKeys.admin.tunnel, queryFn: getTunnel });

  return (
    <>
      <PageHeader title={t('admin.settingsTitle')} description={t('admin.settings.description')} />
      <div className="space-y-8">
        <Section
          id="settings-general"
          title={t('admin.settings.general.title')}
          description={t('admin.settings.general.description')}
        >
          {settings.isPending ? (
            <LoadingState variant="skeleton" lines={3} />
          ) : settings.isError ? (
            <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
          ) : (
            <GeneralSection settings={settings.data.general} />
          )}
        </Section>
        <Section
          id="settings-smtp"
          title={t('admin.settings.smtp.title')}
          description={t('admin.settings.smtp.description')}
        >
          {settings.isPending ? (
            <LoadingState variant="skeleton" lines={4} />
          ) : settings.isError ? null : (
            <SmtpSection smtp={settings.data.smtp} />
          )}
        </Section>
        <Section
          id="settings-tunnel"
          title={t('admin.settings.tunnel.title')}
          description={t('admin.settings.tunnel.description')}
        >
          {tunnel.isPending ? (
            <LoadingState variant="skeleton" lines={3} />
          ) : tunnel.isError ? (
            <ErrorState error={tunnel.error} onRetry={() => void tunnel.refetch()} />
          ) : (
            <TunnelSection tunnel={tunnel.data} />
          )}
        </Section>
      </div>
    </>
  );
}
