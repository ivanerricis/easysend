import {
  SMTP_SECURITY,
  smtpSettingsSchema,
  type SetupSmtpResponse,
  type SmtpSettings,
} from '@easysend/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { queryKeys } from '@/app/query';
import { ErrorState, LoadingState } from '@/components/common/States';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField, TextField } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';
import { Button } from '@/components/ui/button';
import { getSetupSmtp, saveSetupSmtp, testSetupSmtp } from '@/lib/api/setup';
import { isApiError } from '@/lib/api/client';
import { hasErrorCode } from '@/lib/errors';
import { useZodForm } from '../auth/form-errors';
import { apiErrorText } from '../auth/helpers';
import { Notice } from '../auth/Notice';
import { ChoiceField } from './ChoiceField';
import { StepHeading } from './StepHeading';
import { stepActionsClass, type StepProps } from './types';

const formSchema = z
  .object({
    host: z.string(),
    port: z.string(),
    security: z.enum(SMTP_SECURITY),
    username: z.string(),
    password: z.string(),
    fromEmail: z.string(),
    fromName: z.string(),
  })
  .transform((v): SmtpSettings => ({
    host: v.host.trim(),
    port: v.port.trim() === '' ? Number.NaN : Number(v.port.trim()),
    security: v.security,
    username: v.username.trim() === '' ? undefined : v.username.trim(),
    // An empty password keeps the saved one (or none).
    password: v.password === '' ? undefined : v.password,
    fromEmail: v.fromEmail.trim(),
    fromName: v.fromName.trim() === '' ? undefined : v.fromName.trim(),
  }))
  .pipe(smtpSettingsSchema);
type FormValues = z.input<typeof formSchema>;

/** Comparable form of the values: any difference from the tested snapshot invalidates the test. */
function snapshotOf(values: FormValues): string {
  return JSON.stringify([
    values.host.trim(),
    values.port.trim(),
    values.security,
    values.username.trim(),
    values.password,
    values.fromEmail.trim(),
    values.fromName.trim(),
  ]);
}

const SAFE_REASON = /^[A-Z][A-Z0-9_]{1,31}$/;

/** Safe error code reported by the API for a failed test (EAUTH, ECONNREFUSED...), if any. */
function failureReason(error: unknown): string | null {
  if (!isApiError(error)) return null;
  const raw = error.details?.['reason'] ?? error.details?.['code'];
  return typeof raw === 'string' && SAFE_REASON.test(raw) ? raw : null;
}

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
  const defaults: FormValues = {
    host: smtp.host,
    port: String(smtp.port),
    security: smtp.security,
    username: smtp.username ?? '',
    password: '',
    fromEmail: smtp.fromEmail,
    fromName: smtp.fromName ?? '',
  };
  // The server remembers a successful test of the suggested values for a while.
  const [tested, setTested] = useState<{ snapshot: string; sentTo: string | null } | null>(
    initial.verified ? { snapshot: snapshotOf(defaults), sentTo: null } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const { control, handleSubmit, formState } = useZodForm(formSchema, {
    defaultValues: defaults,
  });
  const values = useWatch({ control }) as FormValues;
  const verified = tested !== null && tested.snapshot === snapshotOf(values);
  const mailpitUrl = 'http://localhost:8025';

  const onTest = handleSubmit(async (payload) => {
    setError(null);
    setTesting(true);
    const snapshot = snapshotOf(values);
    try {
      const res = await testSetupSmtp(payload);
      setTested({ snapshot, sentTo: res.sentTo });
    } catch (e) {
      setTested(null);
      if (onFatal(e)) return;
      if (hasErrorCode(e, 'SMTP_TEST_FAILED')) {
        const reason = failureReason(e);
        const base = t('setup.smtp.testFailed');
        setError(
          reason
            ? `${base} ${t('setup.smtp.reasonLabel')} ${t(`setup.smtp.reasons.${reason}`, { defaultValue: reason })}`
            : base,
        );
      } else {
        setError(apiErrorText(t, e));
      }
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
          labels={{
            host: t('setup.smtp.host'),
            port: t('setup.smtp.port'),
            fromEmail: t('setup.smtp.fromEmail'),
          }}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
          <TextField
            control={control}
            name="host"
            label={t('setup.smtp.host')}
            autoComplete="off"
            placeholder="smtp.example.com"
          />
          <TextField
            control={control}
            name="port"
            label={t('setup.smtp.port')}
            inputMode="numeric"
            autoComplete="off"
          />
        </div>
        <ChoiceField
          control={control}
          name="security"
          legend={t('setup.smtp.security')}
          options={[
            {
              value: 'none',
              label: t('setup.smtp.securityNone'),
              description: t('setup.smtp.securityNoneHint'),
            },
            {
              value: 'starttls',
              label: t('setup.smtp.securityStarttls'),
              description: t('setup.smtp.securityStarttlsHint'),
            },
            {
              value: 'tls',
              label: t('setup.smtp.securityTls'),
              description: t('setup.smtp.securityTlsHint'),
            },
          ]}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            control={control}
            name="username"
            label={t('setup.smtp.username')}
            optional
            autoComplete="off"
          />
          <FormField
            control={control}
            name="password"
            label={t('setup.smtp.password')}
            optional
            description={smtp.hasPassword ? t('setup.smtp.passwordKept') : undefined}
          >
            {({ field, controlProps }) => (
              <PasswordInput autoComplete="new-password" {...field} {...controlProps} />
            )}
          </FormField>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            control={control}
            name="fromEmail"
            label={t('setup.smtp.fromEmail')}
            type="email"
            inputMode="email"
            autoComplete="off"
          />
          <TextField
            control={control}
            name="fromName"
            label={t('setup.smtp.fromName')}
            optional
            autoComplete="off"
          />
        </div>

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
