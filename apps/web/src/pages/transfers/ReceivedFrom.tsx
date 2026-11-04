import type { TransferSummary } from '@easysend/shared';
import { Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Who sent a received transfer: the name, else the email, else "anonymous". */
export function senderLabel(
  transfer: Pick<TransferSummary, 'senderName' | 'senderEmail'>,
  anonymous: string,
): string {
  return transfer.senderName?.trim() || transfer.senderEmail || anonymous;
}

/** "Received from ..." line for transfers that came in through an upload request. */
export function ReceivedFrom({
  transfer,
  className,
}: {
  transfer: Pick<TransferSummary, 'source' | 'senderName' | 'senderEmail'>;
  className?: string;
}) {
  const { t } = useTranslation();
  if (transfer.source !== 'received') return null;
  const who = senderLabel(transfer, t('transfers.received.anonymous'));
  return (
    <span className={className ?? 'text-muted-foreground inline-flex items-center gap-1 text-xs'}>
      <Inbox aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="break-words">{t('transfers.received.from', { who })}</span>
    </span>
  );
}
