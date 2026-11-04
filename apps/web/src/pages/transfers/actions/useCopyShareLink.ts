import { useTranslation } from 'react-i18next';
import { copyText } from '@/components/common/CopyButton';
import { notifyError, notifySuccess } from '@/lib/toast';

/** Copies a transfer's share link and reports the result with a toast. */
export function useCopyShareLink() {
  const { t } = useTranslation();
  return async (url: string) => {
    if (await copyText(url)) notifySuccess(t('transfers.actions.linkCopied'));
    else notifyError(t('common.actions.copyFailed'));
  };
}
