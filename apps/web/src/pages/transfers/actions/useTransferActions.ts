import type { TransferDetail } from '@easysend/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { deleteTransfer, resendTransfer, revokeTransfer } from '@/lib/api/transfers';
import { errorMessage } from '@/lib/errors';
import { notifyError, notifySuccess } from '@/lib/toast';

/**
 * Revoke, delete and resend of a transfer with the same API calls, toasts and query
 * invalidations wherever they are offered (detail page, list rows). `revoke` and `remove` throw
 * after reporting the error, so a `ConfirmDialog` stays open; `resend` reports and swallows it.
 */
export function useTransferActions(id: string, options: { isDraft?: boolean } = {}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [resending, setResending] = useState(false);

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.transfers.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  };

  const setDetail = (updated: TransferDetail) => {
    queryClient.setQueryData(queryKeys.transfers.detail(id), updated);
    refreshLists();
  };

  const revoke = async () => {
    try {
      setDetail(await revokeTransfer(id));
      notifySuccess(t('transfers.detail.revoked'));
    } catch (error) {
      notifyError(errorMessage(t, error));
      throw error;
    }
  };

  /** Deletes the transfer; the caller decides where to go next. */
  const remove = async () => {
    try {
      await deleteTransfer(id);
    } catch (error) {
      notifyError(errorMessage(t, error));
      throw error;
    }
    queryClient.removeQueries({ queryKey: queryKeys.transfers.detail(id) });
    refreshLists();
    notifySuccess(
      t(options.isDraft ? 'transfers.detail.draftDeleted' : 'transfers.detail.deleted'),
    );
  };

  const resend = async () => {
    setResending(true);
    try {
      setDetail(await resendTransfer(id));
      notifySuccess(t('transfers.detail.resent'));
    } catch (error) {
      notifyError(errorMessage(t, error));
    } finally {
      setResending(false);
    }
  };

  return { revoke, remove, resend, resending, setDetail, refreshLists };
}
