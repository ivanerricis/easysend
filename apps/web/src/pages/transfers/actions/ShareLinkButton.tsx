import { Copy, Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useCopyShareLink } from './useCopyShareLink';

interface ShareLinkButtonProps {
  url: string;
  /** Transfer title (or the fallback) used in the accessible name, after the visible label (WCAG 2.5.3). */
  title: string;
  /** Show the link icon before the label (list table) or not (admin sub-line). */
  withLinkIcon?: boolean;
  label: string;
}

/** Compact button that copies the share link; the visible text is the mode label. */
export function ShareLinkButton({ url, title, label, withLinkIcon }: ShareLinkButtonProps) {
  const { t } = useTranslation();
  const copy = useCopyShareLink();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ml-3 h-auto gap-1.5 px-3 py-1 font-normal"
      aria-label={t('transfers.actions.copyLinkOf', { label, title })}
      onClick={() => void copy(url)}
    >
      {withLinkIcon ? <Link2 aria-hidden="true" className="size-4" /> : null}
      {label}
      <Copy aria-hidden="true" className="size-3" />
    </Button>
  );
}
