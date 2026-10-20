import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';

/** 404 page; also shown to non-admins on admin routes (no 403, as in the API). */
export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto w-full max-w-xl py-8">
      <PageHeader
        title={t('common.notFound.title')}
        description={t('common.notFound.description')}
      />
      <Button asChild>
        <Link to="/">{t('common.notFound.home')}</Link>
      </Button>
    </div>
  );
}
