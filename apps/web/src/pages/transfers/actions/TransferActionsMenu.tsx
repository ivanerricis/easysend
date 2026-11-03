import type { TransferMode, TransferStatus } from '@easysend/shared';
import { useQuery } from '@tanstack/react-query';
import { Ban, Copy, Eye, Mail, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { RowActionsMenu, restoreRowFocus } from '@/components/common/RowActionsMenu';
import { getTransfer } from '@/lib/api/transfers';
import { EditTransferDialog } from '../detail/EditTransferDialog';
import { useTransferActions } from './useTransferActions';

interface TransferActionsMenuProps {
  transfer: {
    id: string;
    title: string | null;
    status: TransferStatus;
    mode: TransferMode;
    shareUrl: string | null;
  };
  /** Title shown in the accessible name when the transfer has none. */
  fallbackTitle: string;
}

/**
 * Per-row actions menu of the transfer lists: open details, edit, resend, revoke and delete,
 * copy the share link, limited to what the row's status allows. It owns the dialogs it opens.
 */
export function TransferActionsMenu({ transfer, fallbackTitle }: TransferActionsMenuProps) {
  const { t } = useTranslation();
  const isDraft = transfer.status === 'uploading';
  const isActive = transfer.status === 'active';
  const actions = useTransferActions(transfer.id, { isDraft });
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'revoke' | 'delete' | null>(null);

  // The edit dialog needs the full transfer (share link, recipients...): fetched when it opens.
  const detail = useQuery({
    queryKey: queryKeys.transfers.detail(transfer.id),
    queryFn: () => getTransfer(transfer.id),
    enabled: editing,
  });

  return (
    <>
      <RowActionsMenu
        label={t('transfers.actions.menu', { title: transfer.title ?? fallbackTitle })}
        actions={[
          {
            key: 'open',
            label: t('transfers.actions.open'),
            icon: Eye,
            to: `/transfers/${transfer.id}`,
          },
          {
            key: 'copy-link',
            label: t('transfers.success.copyLink'),
            icon: Copy,
            hidden: !transfer.shareUrl,
            onSelect: () => transfer.shareUrl && void actions.copyLink(transfer.shareUrl),
          },
          {
            key: 'edit',
            label: t('common.actions.edit'),
            icon: Pencil,
            hidden: !isActive,
            onSelect: () => setEditing(true),
          },
          {
            key: 'resend',
            label: t('transfers.detail.resend'),
            icon: Mail,
            hidden: !(isActive && transfer.mode === 'email'),
            disabled: actions.resending,
            onSelect: () => void actions.resend(),
          },
          {
            key: 'revoke',
            label: t('common.actions.revoke'),
            icon: Ban,
            hidden: !isActive,
            onSelect: () => setConfirm('revoke'),
          },
          {
            key: 'delete',
            label: t('common.actions.delete'),
            icon: Trash2,
            destructive: true,
            onSelect: () => setConfirm('delete'),
          },
        ]}
      />

      {isActive && detail.data ? (
        <EditTransferDialog
          transfer={detail.data}
          open={editing}
          onOpenChange={setEditing}
          onCloseAutoFocus={restoreRowFocus}
        />
      ) : null}
      <ConfirmDialog
        open={confirm === 'revoke'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('transfers.detail.revokeTitle')}
        description={t('transfers.detail.revokeDescription')}
        confirmLabel={t('common.actions.revoke')}
        destructive
        onCloseAutoFocus={restoreRowFocus}
        onConfirm={actions.revoke}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t(isDraft ? 'transfers.detail.deleteDraftTitle' : 'transfers.detail.deleteTitle')}
        description={t(
          isDraft
            ? 'transfers.detail.deleteDraftDescription'
            : 'transfers.detail.deleteDescription',
        )}
        confirmLabel={t('common.actions.delete')}
        destructive
        onCloseAutoFocus={restoreRowFocus}
        onConfirm={actions.remove}
      />
    </>
  );
}
