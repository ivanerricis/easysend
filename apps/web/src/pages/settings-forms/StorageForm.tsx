import type {
  StorageSettingsResponse,
  StorageTestRequest,
  StorageUpdateRequest,
} from '@easysend/shared';
import { useState } from 'react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { Button } from '@/components/ui/button';
import { hasErrorCode } from '@/lib/errors';
import { useZodForm } from '../auth/form-errors';
import { apiErrorText } from '../auth/helpers';
import { Notice } from '../auth/Notice';
import { StorageFields, storageFieldLabels } from './StorageFields';
import {
  storageFormDefaults,
  storageFormSchema,
  storageSnapshot,
  storageTestFailureText,
  type StorageFormValues,
} from './storage';

interface StorageFormProps {
  settings: StorageSettingsResponse;
  idPrefix: string;
  test: (body: StorageTestRequest) => Promise<unknown>;
  save: (body: StorageUpdateRequest) => Promise<StorageSettingsResponse>;
  /** Called with the saved configuration (the panel refreshes its cache, the wizard moves on). */
  onSaved: (response: StorageSettingsResponse) => void | Promise<void>;
  /** Wizard: handles errors that end the whole step (returns true when it did). */
  onFatal?: (error: unknown) => boolean;
  saveLabels?: { local: string; s3: string };
  actionsClassName: string;
}

/**
 * Driver choice plus the S3 fields with the same test-then-save flow as the SMTP form: saving an
 * S3 configuration stays disabled until the exact current values passed a connection test;
 * choosing the local disk needs no test. The secret key is write-only.
 */
export function StorageForm({
  settings,
  idPrefix,
  test,
  save,
  onSaved,
  onFatal,
  saveLabels,
  actionsClassName,
}: StorageFormProps) {
  const { t } = useTranslation();
  const hasSecret = settings.s3?.hasSecret ?? false;
  const [verified, setVerified] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const {
    control,
    handleSubmit,
    getValues,
    reset,
    setError: setFieldError,
    formState,
  } = useZodForm(storageFormSchema, {
    defaultValues: storageFormDefaults(settings.driver, settings.s3),
  });
  // `useWatch` re-renders on every edit, so the "tested" state is re-evaluated immediately.
  const values = useWatch({ control }) as StorageFormValues;
  const isS3 = values.driver === 's3';
  const snapshot = storageSnapshot(values);
  const isVerified = verified !== null && verified === snapshot;

  /** A new secret is needed when none is saved yet; flags the field and tells the caller to stop. */
  const missingSecret = (payload: StorageUpdateRequest) => {
    if (payload.driver !== 's3' || payload.s3?.secretAccessKey || hasSecret) return false;
    setFieldError('secretAccessKey', { message: 'setup.storage.errors.required' });
    return true;
  };

  const onTest = handleSubmit(async (payload) => {
    if (payload.driver !== 's3' || !payload.s3 || missingSecret(payload)) return;
    setError(null);
    setTesting(true);
    const key = storageSnapshot(getValues());
    try {
      await test({ s3: payload.s3 });
      setVerified(key);
    } catch (e) {
      setVerified(null);
      if (onFatal?.(e)) return;
      setError(storageTestFailureText(t, e) ?? apiErrorText(t, e));
    } finally {
      setTesting(false);
    }
  });

  const onSave = handleSubmit(async (payload) => {
    if (payload.driver === 's3' && (!isVerified || missingSecret(payload))) return;
    setError(null);
    setSaving(true);
    try {
      const response = await save(payload);
      setVerified(null);
      reset(storageFormDefaults(response.driver, response.s3));
      await onSaved(response);
    } catch (e) {
      if (onFatal?.(e)) return;
      if (hasErrorCode(e, 'STORAGE_NOT_VERIFIED')) setVerified(null);
      setError(apiErrorText(t, e));
    } finally {
      setSaving(false);
    }
  });

  const busy = testing || saving;
  const saveLabel = isS3
    ? (saveLabels?.s3 ?? t('common.actions.save'))
    : (saveLabels?.local ?? t('common.actions.save'));

  return (
    <form
      noValidate
      className="max-w-xl space-y-5"
      onSubmit={(event) => void (isS3 ? onTest(event) : onSave(event))}
    >
      <FormErrorSummary
        errors={formState.errors}
        submitCount={formState.submitCount}
        idPrefix={idPrefix}
        labels={storageFieldLabels(t)}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <StorageFields
        control={control}
        idPrefix={idPrefix}
        driver={values.driver}
        hasSecret={hasSecret}
        locked={settings.locked}
      />

      {isS3 ? (
        <div aria-live="polite">
          {isVerified ? (
            <Notice tone="success" title={t('setup.storage.testOk')} role="none">
              <p>{t('setup.storage.testOkBody')}</p>
            </Notice>
          ) : (
            <p className="text-muted-foreground text-sm">
              {verified ? t('setup.storage.changedSinceTest') : t('setup.storage.testRequired')}
            </p>
          )}
        </div>
      ) : null}

      <div className={actionsClassName}>
        {isS3 ? (
          <Button type="submit" variant="outline" disabled={busy} aria-busy={testing}>
            {testing ? t('setup.storage.testing') : t('setup.storage.test')}
          </Button>
        ) : null}
        <Button
          type={isS3 ? 'button' : 'submit'}
          disabled={(isS3 && !isVerified) || busy}
          aria-busy={saving}
          onClick={isS3 ? () => void onSave() : undefined}
        >
          {saving ? t('common.actions.saving') : saveLabel}
        </Button>
      </div>
    </form>
  );
}
