import type { UploadRequestDetail } from '@easysend/shared';
import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '@/components/common/CopyButton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The link of a request that was just created, kept in the page (not in a toast) until the user
 * dismisses it, so it can be copied at any time.
 */
export function CreatedLinkCard({
  request,
  onDismiss,
}: {
  request: UploadRequestDetail;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Alert role="status" className="mb-6">
      <CheckCircle2 aria-hidden="true" />
      <AlertTitle>{t('requests.created.title')}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{t('requests.created.description')}</p>
        {request.shareUrl ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              readOnly
              aria-label={t('requests.created.link')}
              value={request.shareUrl}
              className="font-mono"
              onFocus={(event) => event.currentTarget.select()}
            />
            <CopyButton value={request.shareUrl}>{t('requests.created.copy')}</CopyButton>
          </div>
        ) : (
          <p>{t('requests.created.noLink')}</p>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          {t('requests.created.dismiss')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
