import type { UploadRequestSummary } from '@easysend/shared';
import { useQuery } from '@tanstack/react-query';
import { Ban, Copy, Eye, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { RowActionsMenu, restoreRowFocus } from '@/components/common/RowActionsMenu';
import { getUploadRequest } from '@/lib/api/requests';
import { RequestFormDialog } from './RequestFormDialog';
import { useRequestActions } from './useRequestActions';

/**
 * Per-row actions menu of the request list: open, copy link, edit, revoke and delete, limited to
 * what the row's status allows. It owns the dialogs it opens.
 */
export function RequestActionsMenu({ request }: { request: UploadRequestSummary }) {
  const { t } = useTranslation();
  const isActive = request.status === 'active';
  const actions = useRequestActions(request.id);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'revoke' | 'delete' | null>(null);

  // The edit dialog needs the instructions, which the list does not carry: fetched on open.
  const detail = useQuery({
    queryKey: queryKeys.requests.detail(request.id),
    queryFn: () => getUploadRequest(request.id),
    enabled: editing,
  });

  return (
    <>
      <RowActionsMenu
        label={t('requests.actions.menu', { title: request.title })}
        actions={[
          {
            key: 'open',
            label: t('requests.actions.open'),
            icon: Eye,
            to: `/requests/${request.id}`,
          },
          {
            key: 'copy',
            label: t('requests.actions.copyLink'),
            icon: Copy,
            hidden: !isActive || !request.shareUrl,
            onSelect: () => void actions.copyLink(request.shareUrl ?? ''),
          },
          {
            key: 'edit',
            label: t('common.actions.edit'),
            icon: Pencil,
            hidden: !isActive,
            onSelect: () => setEditing(true),
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
        <RequestFormDialog
          request={detail.data}
          open={editing}
          onOpenChange={setEditing}
          onCloseAutoFocus={restoreRowFocus}
        />
      ) : null}
      <ConfirmDialog
        open={confirm === 'revoke'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('requests.revokeTitle')}
        description={t('requests.revokeDescription')}
        confirmLabel={t('common.actions.revoke')}
        destructive
        onCloseAutoFocus={restoreRowFocus}
        onConfirm={actions.revoke}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('requests.deleteTitle')}
        description={t('requests.deleteDescription')}
        confirmLabel={t('common.actions.delete')}
        destructive
        onCloseAutoFocus={restoreRowFocus}
        onConfirm={actions.remove}
      />
    </>
  );
}
