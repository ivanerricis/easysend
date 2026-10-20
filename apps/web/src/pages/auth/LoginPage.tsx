import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/common/PageHeader';
import { PublicCard } from '@/components/layout/PublicLayout';

/** Stub: replaced by the page implementation. */
export default function LoginPage() {
  const { t } = useTranslation();
  return (
    <PublicCard width="narrow">
      <PageHeader title={t('auth.title')} />
      <p className="text-muted-foreground text-sm">Coming soon.</p>
    </PublicCard>
  );
}
