import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { ErrorState, LoadingState } from '@/components/common/States';
import { getSetupStorage, saveSetupStorage, testSetupStorage } from '@/lib/api/setup';
import { StorageForm } from '../settings-forms/StorageForm';
import { StepHeading } from './StepHeading';
import { stepActionsClass, type StepProps } from './types';

/**
 * Optional step: the local disk (default, one click to continue) or an S3-compatible service,
 * saved only after a successful connection test. The setup status has no `storage` flag, so the
 * wizard never blocks on this step.
 */
export function StorageStep({ onFatal, onDone }: Pick<StepProps, 'onFatal' | 'onDone'>) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: queryKeys.setup.storage,
    queryFn: getSetupStorage,
    staleTime: Infinity,
  });
  if (query.isPending) {
    return (
      <div>
        <StepHeading>{t('setup.storage.title')}</StepHeading>
        <LoadingState />
      </div>
    );
  }
  if (query.isError) {
    if (onFatal(query.error)) return null;
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  return (
    <div>
      <StepHeading description={t('setup.storage.intro')}>{t('setup.storage.title')}</StepHeading>
      <StorageForm
        settings={query.data}
        idPrefix="storage"
        test={testSetupStorage}
        save={saveSetupStorage}
        onFatal={onFatal}
        onSaved={() => onDone()}
        saveLabels={{ local: t('common.actions.continue'), s3: t('setup.storage.saveContinue') }}
        actionsClassName={stepActionsClass}
      />
    </div>
  );
}
