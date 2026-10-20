import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/common/PageHeader';

/** Stub: replaced by the page implementation. */
export default function ProfilePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('profile.title')} />
      <p className="text-muted-foreground text-sm">Coming soon.</p>
    </>
  );
}
