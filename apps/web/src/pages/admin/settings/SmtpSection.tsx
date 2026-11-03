import type { SmtpSettings, SmtpSettingsPublic } from '@easysend/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { saveSmtp, testSmtp } from '@/lib/api/settings';
import { errorMessage } from '@/lib/errors';
import { notifySuccess } from '@/lib/toast';
import { useZodForm } from '../../auth/form-errors';
import { SmtpFields, smtpFieldLabels } from '../../settings-forms/SmtpFields';
import {
  smtpFormDefaults,
  smtpFormSchema,
  smtpSnapshot,
  smtpTestFailureText,
} from '../../settings-forms/smtp';

interface Attempt {
  payload: SmtpSettings;
  /** Snapshot of the form values the payload came from. */
  key: string;
}

export function SmtpSection({ smtp }: { smtp: SmtpSettingsPublic | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [hasPassword, setHasPassword] = useState(smtp?.hasPassword ?? false);
  const [verified, setVerified] = useState<{ key: string; sentTo: string } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { control, handleSubmit, getValues, reset, formState } = useZodForm(smtpFormSchema, {
    defaultValues: smtpFormDefaults(smtp),
  });
  // `useWatch` re-renders on every edit, so the "tested" state is re-evaluated immediately.
  const current = smtpSnapshot(useWatch({ control }));
  const isVerified = verified !== null && verified.key === current;

  const test = useMutation({
    mutationFn: (attempt: Attempt) => testSmtp(attempt.payload),
    onSuccess: (response, attempt) => {
      setTestError(null);
      setSaveError(null);
      setVerified({ key: attempt.key, sentTo: response.sentTo });
    },
    onError: (error) => {
      setVerified(null);
      setTestError(smtpTestFailureText(t, error) ?? errorMessage(t, error));
    },
  });

  const save = useMutation({
    mutationFn: (attempt: Attempt) => saveSmtp(attempt.payload),
    onSuccess: async (response) => {
      setVerified(null);
      setSaveError(null);
      setHasPassword(response.hasPassword);
      reset(smtpFormDefaults(response));
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.settings });
      notifySuccess(t('admin.settings.savedToast'));
    },
    onError: (error) => setSaveError(errorMessage(t, error)),
  });

  const runTest = handleSubmit((payload) => {
    setTestError(null);
    setSaveError(null);
    test.mutate({ payload, key: smtpSnapshot(getValues()) });
  });

  return (
    <form
      noValidate
      className="max-w-xl space-y-5"
      onSubmit={(event) =>
        void handleSubmit((payload) => {
          setSaveError(null);
          const key = smtpSnapshot(getValues());
          if (key !== verified?.key) return;
          save.mutate({ payload, key });
        })(event)
      }
    >
      <FormErrorSummary
        errors={formState.errors}
        submitCount={formState.submitCount}
        idPrefix="smtp"
        labels={smtpFieldLabels(t)}
      />
      <SmtpFields control={control} idPrefix="smtp" hasPassword={hasPassword} />

      <div aria-live="polite" className="space-y-2">
        {testError ? (
          <Alert variant="destructive">
            <AlertDescription>{testError}</AlertDescription>
          </Alert>
        ) : null}
        {saveError ? (
          <Alert variant="destructive">
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        ) : null}
        {isVerified ? (
          <Alert>
            <CheckCircle2 aria-hidden="true" />
            <AlertDescription>
              {t('admin.settings.smtp.testOk', { email: verified.sentTo })}
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-muted-foreground text-sm">{t('admin.settings.smtp.testFirst')}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={test.isPending}
          aria-busy={test.isPending}
          onClick={() => void runTest()}
        >
          {test.isPending ? t('admin.settings.smtp.testing') : t('admin.settings.smtp.test')}
        </Button>
        <Button type="submit" disabled={!isVerified || save.isPending} aria-busy={save.isPending}>
          {save.isPending ? t('common.actions.saving') : t('common.actions.save')}
        </Button>
      </div>
    </form>
  );
}
