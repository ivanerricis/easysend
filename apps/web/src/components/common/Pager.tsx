import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Shows the total count next to the page number (default). Turn off if shown elsewhere. */
  showTotal?: boolean;
  className?: string;
}

/** Previous / next navigation with "Page X of Y" and the total count. */
export function Pager({
  page,
  pageSize,
  total,
  onPageChange,
  showTotal = true,
  className,
}: PagerProps) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav
      aria-label={t('common.pagination.label')}
      className={cn('flex flex-wrap items-center justify-between gap-3', className)}
    >
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {showTotal ? (
          <>
            <span className="font-mono">{t('common.pagination.total', { count: total })}</span>
            {' · '}
          </>
        ) : null}
        {t('common.pagination.pageOf', { page, pages })}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={page <= 1}
          aria-label={t('common.pagination.previous')}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={page >= pages}
          aria-label={t('common.pagination.next')}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
