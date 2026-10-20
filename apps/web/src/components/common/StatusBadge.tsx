import type { TransferStatus } from '@easysend/shared';
import { Ban, CheckCircle2, Clock, Trash2, UploadCloud, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

const STATUS_STYLE: Record<
  TransferStatus,
  { icon: LucideIcon; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  uploading: { icon: UploadCloud, variant: 'secondary' },
  active: { icon: CheckCircle2, variant: 'default' },
  revoked: { icon: Ban, variant: 'destructive' },
  expired: { icon: Clock, variant: 'outline' },
  deleted: { icon: Trash2, variant: 'outline' },
};

/** Transfer status as text plus an icon (never colour only). */
export function StatusBadge({ status }: { status: TransferStatus }) {
  const { t } = useTranslation();
  const { icon: Icon, variant } = STATUS_STYLE[status];
  return (
    <Badge variant={variant} className="h-6 gap-1.5 px-2">
      <Icon aria-hidden="true" />
      {t(`common.status.${status}`)}
    </Badge>
  );
}
