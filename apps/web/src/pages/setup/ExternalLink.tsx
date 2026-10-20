import { ExternalLink as ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Link to another site: new tab, `noopener`, and the new tab is announced and shown by an icon. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary inline-flex min-h-11 items-center gap-1 underline underline-offset-4 hover:no-underline"
    >
      {children}
      <span className="sr-only"> ({t('setup.opensInNewTab')})</span>
      <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
    </a>
  );
}
