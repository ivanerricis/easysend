import type { UploadRequestDetail } from '@easysend/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { copyText } from '@/components/common/CopyButton';
import { deleteUploadRequest, revokeUploadRequest } from '@/lib/api/requests';
import { errorMessage } from '@/lib/errors';
import { notifyError, notifySuccess } from '@/lib/toast';

/**
 * Revoke, delete and copy-link of an upload request with the same API calls, toasts and query
 * invalidations wherever they are offered (list rows, detail page). `revoke` and `remove` throw
 * after reporting the error, so a `ConfirmDialog` stays open.
 */
export function useRequestActions(id: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.requests.all });
  };

  const revoke = async () => {
    let updated: UploadRequestDetail;
    try {
      updated = await revokeUploadRequest(id);
    } catch (error) {
      notifyError(errorMessage(t, error));
      throw error;
    }
    queryClient.setQueryData(queryKeys.requests.detail(id), updated);
    refreshLists();
    notifySuccess(t('requests.revoked'));
  };

  /** Deletes the request; the caller decides where to go next. */
  const remove = async () => {
    try {
      await deleteUploadRequest(id);
    } catch (error) {
      notifyError(errorMessage(t, error));
      throw error;
    }
    queryClient.removeQueries({ queryKey: queryKeys.requests.detail(id) });
    refreshLists();
    // Received transfers stay, now without a link to the request.
    void queryClient.invalidateQueries({ queryKey: queryKeys.transfers.all });
    notifySuccess(t('requests.deleted'));
  };

  const copyLink = async (url: string) => {
    if (await copyText(url)) notifySuccess(t('common.actions.copied'));
    else notifyError(t('common.actions.copyFailed'));
  };

  return { revoke, remove, copyLink };
}
