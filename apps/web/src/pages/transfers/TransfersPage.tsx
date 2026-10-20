import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/common/PageHeader';

/** Stub: replaced by the page implementation. */
export default function TransfersPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('transfers.title')} />
      <p className="text-muted-foreground text-sm">Coming soon.</p>
    </>
  );
}
