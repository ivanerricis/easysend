import type { SetupSmtpResponse } from '@easysend/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { ErrorState, LoadingState } from '@/components/common/States';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { Button } from '@/components/ui/button';
import { getSetupSmtp, saveSetupSmtp, testSetupSmtp } from '@/lib/api/setup';
import { hasErrorCode } from '@/lib/errors';
import { useZodForm } from '../auth/form-errors';
import { apiErrorText } from '../auth/helpers';
import { Notice } from '../auth/Notice';
import { SmtpFields, smtpFieldLabels } from '../settings-forms/SmtpFields';
import {
  smtpFormDefaults,
  smtpFormSchema,
  smtpSnapshot,
  smtpTestFailureText,
  type SmtpFormValues,
} from '../settings-forms/smtp';
import { StepHeading } from './StepHeading';
import { stepActionsClass, type StepProps } from './types';

export function SmtpStep(props: StepProps) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: queryKeys.setup.smtp,
    queryFn: getSetupSmtp,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  if (query.isPending) {
    return (
      <div>
        <StepHeading>{t('setup.smtp.title')}</StepHeading>
        <LoadingState />
      </div>
    );
  }
  if (query.isError) {
    if (props.onFatal(query.error)) return null;
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  return <SmtpForm {...props} initial={query.data} />;
}

function SmtpForm({
  appMode,
  onFatal,
  onDone,
  initial,
}: StepProps & { initial: SetupSmtpResponse }) {
  const { t } = useTranslation();
  const { smtp } = initial;
  const defaults = smtpFormDefaults(smtp);
  // The server remembers a successful test of the suggested values for a while.
  const [tested, setTested] = useState<{ snapshot: string; sentTo: string | null } | null>(
    initial.verified ? { snapshot: smtpSnapshot(defaults), sentTo: null } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const { control, handleSubmit, formState } = useZodForm(smtpFormSchema, {
    defaultValues: defaults,
  });
  const values = useWatch({ control }) as SmtpFormValues;
  const verified = tested !== null && tested.snapshot === smtpSnapshot(values);
  const mailpitUrl = 'http://localhost:8025';

  const onTest = handleSubmit(async (payload) => {
    setError(null);
    setTesting(true);
    const snapshot = smtpSnapshot(values);
    try {
      const res = await testSetupSmtp(payload);
      setTested({ snapshot, sentTo: res.sentTo });
    } catch (e) {
      setTested(null);
      if (onFatal(e)) return;
      setError(smtpTestFailureText(t, e) ?? apiErrorText(t, e));
    } finally {
      setTesting(false);
    }
  });

  const onSave = handleSubmit(async (payload) => {
    setError(null);
    setSaving(true);
    try {
      await saveSetupSmtp(payload);
      onDone({ smtpHost: payload.host, smtpFrom: payload.fromEmail });
    } catch (e) {
      if (onFatal(e)) return;
      if (hasErrorCode(e, 'SMTP_NOT_VERIFIED')) setTested(null);
      setError(apiErrorText(t, e));
    } finally {
      setSaving(false);
    }
  });

  const busy = testing || saving;
  return (
    <div>
      <StepHeading description={t('setup.smtp.intro')}>{t('setup.smtp.title')}</StepHeading>
      <form onSubmit={(event) => void onTest(event)} noValidate className="space-y-5">
        {appMode === 'local' ? (
          <Notice tone="info" title={t('setup.smtp.localTitle')}>
            <p>{t('setup.smtp.localBody')}</p>
          </Notice>
        ) : null}
        <FormErrorSummary
          errors={formState.errors}
          submitCount={formState.submitCount}
          labels={smtpFieldLabels(t)}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <SmtpFields control={control} hasPassword={smtp.hasPassword} />

        <div aria-live="polite">
          {verified ? (
            <Notice tone="success" title={t('setup.smtp.testOk')} role="none">
              {tested.sentTo ? (
                <p>{t('setup.smtp.testSentTo', { email: tested.sentTo })}</p>
              ) : (
                <p>{t('setup.smtp.testRemembered')}</p>
              )}
              {appMode === 'local' ? (
                <p>{t('setup.smtp.testMailpit', { url: mailpitUrl })}</p>
              ) : null}
            </Notice>
          ) : (
            <p className="text-muted-foreground text-sm">
              {tested ? t('setup.smtp.changedSinceTest') : t('setup.smtp.testRequired')}
            </p>
          )}
        </div>

        <div className={stepActionsClass}>
          <Button type="submit" variant="outline" disabled={busy}>
            {testing ? t('setup.smtp.testing') : t('setup.smtp.test')}
          </Button>
          <Button type="button" disabled={!verified || busy} onClick={() => void onSave()}>
            {saving ? t('common.actions.saving') : t('setup.smtp.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
