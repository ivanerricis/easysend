import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/common/PageHeader';
import { PublicCard } from '@/components/layout/PublicLayout';

/** Stub: replaced by the page implementation. */
export default function SetupPage() {
  const { t } = useTranslation();
  return (
    <PublicCard width="wide">
      <PageHeader title={t('setup.title')} />
      <p className="text-muted-foreground text-sm">Coming soon.</p>
    </PublicCard>
  );
}
