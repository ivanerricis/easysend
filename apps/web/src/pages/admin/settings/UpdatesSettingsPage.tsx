import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/common/PageHeader';
import { UpdatesSection } from './UpdatesSection';

export default function UpdatesSettingsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        title={t('admin.settings.updates.title')}
        description={t('admin.settings.updates.description')}
      />
      <UpdatesSection />
    </>
  );
}
