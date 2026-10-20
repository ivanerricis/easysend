import type { TransferDetail } from '@easysend/shared';
import { CheckCircle2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CopyButton } from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatBytes, formatDateTime } from '@/lib/format';

interface SuccessPanelProps {
  transfer: TransferDetail;
  onNew: () => void;
}

/** Shown after finalize: the link stays on screen (it is not a toast) with a short summary. */
export function SuccessPanel({ transfer, onNew }: SuccessPanelProps) {
  const { t, i18n } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const locale = i18n.language;

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const notified = transfer.recipients.filter((r) => r.notifiedAt !== null);
  return (
    <section aria-labelledby="success-heading" className="space-y-5">
      <div className="flex items-center gap-2">
        <CheckCircle2 aria-hidden="true" className="text-primary size-6 shrink-0" />
        <h2
          id="success-heading"
          ref={heading}
          tabIndex={-1}
          className="text-xl font-semibold outline-none"
        >
          {t('transfers.success.title')}
        </h2>
      </div>

      {transfer.shareUrl ? (
        <div className="space-y-2">
          <label htmlFor="share-url" className="text-sm font-medium">
            {t('transfers.success.link')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="share-url"
              readOnly
              value={transfer.shareUrl}
              className="font-mono"
              onFocus={(event) => event.currentTarget.select()}
            />
            <CopyButton value={transfer.shareUrl}>{t('transfers.success.copyLink')}</CopyButton>
          </div>
        </div>
      ) : null}

      <dl className="border-border grid gap-x-6 gap-y-3 border p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t('transfers.success.files')}</dt>
          <dd>
            {t('common.units.files', { count: transfer.fileCount })} ·{' '}
            <span className="font-mono">{formatBytes(transfer.totalBytes, locale)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('transfers.success.expires')}</dt>
          <dd>{formatDateTime(transfer.expiresAt, locale)}</dd>
        </div>
        {transfer.mode === 'email' ? (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">{t('transfers.success.notified')}</dt>
            <dd className="break-all">
              {notified.length > 0
                ? notified.map((r) => r.email).join(', ')
                : t('transfers.success.notNotified')}
            </dd>
          </div>
        ) : null}
        {transfer.hasPassword ? (
          <div>
            <dt className="text-muted-foreground">{t('transfers.detail.password')}</dt>
            <dd>{t('transfers.detail.passwordSet')}</dd>
          </div>
        ) : null}
        {transfer.maxDownloads !== null ? (
          <div>
            <dt className="text-muted-foreground">{t('transfers.detail.maxDownloads')}</dt>
            <dd className="font-mono">{transfer.maxDownloads}</dd>
          </div>
        ) : null}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onNew}>
          {t('transfers.success.newTransfer')}
        </Button>
        <Button asChild variant="outline">
          <Link to={`/transfers/${transfer.id}`}>{t('transfers.success.viewTransfer')}</Link>
        </Button>
      </div>
    </section>
  );
}
