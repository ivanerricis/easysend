import { zodResolver } from '@hookform/resolvers/zod';
import {
  EMAIL_MAX_LENGTH,
  SMTP_SECURITY,
  type SmtpSettings,
  type SmtpSettingsPublic,
} from '@easysend/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { queryKeys } from '@/app/query';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField, TextField } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api/client';
import { saveSmtp, testSmtp } from '@/lib/api/settings';
import { errorMessage } from '@/lib/errors';
import { notifySuccess } from '@/lib/toast';
import { NativeSelect } from '../components/NativeSelect';

const formSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1, { error: 'admin.settings.smtp.errors.host' })
    .max(255, { error: 'admin.settings.smtp.errors.host' }),
  port: z
    .string()
    .trim()
    .refine((value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65_535, {
      error: 'admin.settings.smtp.errors.port',
    }),
  security: z.enum(SMTP_SECURITY),
  username: z.string().trim().max(255, { error: 'admin.settings.smtp.errors.username' }),
  password: z.string().max(1024, { error: 'admin.settings.smtp.errors.password' }),
  fromEmail: z
    .string()
    .trim()
    .min(1, { error: 'admin.settings.smtp.errors.fromEmail' })
    .max(EMAIL_MAX_LENGTH, { error: 'admin.settings.smtp.errors.fromEmail' })
    .refine((value) => z.email().safeParse(value).success, {
      error: 'admin.settings.smtp.errors.fromEmail',
    }),
  fromName: z.string().trim().max(100, { error: 'admin.settings.smtp.errors.fromName' }),
});
type FormValues = z.infer<typeof formSchema>;

function toFormValues(smtp: SmtpSettingsPublic | null): FormValues {
  return {
    host: smtp?.host ?? '',
    port: String(smtp?.port ?? 587),
    security: smtp?.security ?? 'starttls',
    username: smtp?.username ?? '',
    password: '',
    fromEmail: smtp?.fromEmail ?? '',
    fromName: smtp?.fromName ?? '',
  };
}

function toRequest(values: FormValues): SmtpSettings {
  return {
    host: values.host.trim(),
    port: Number(values.port),
    security: values.security,
    ...(values.username.trim() ? { username: values.username.trim() } : {}),
    ...(values.password ? { password: values.password } : {}),
    fromEmail: values.fromEmail.trim(),
    ...(values.fromName.trim() ? { fromName: values.fromName.trim() } : {}),
  };
}

/** Fingerprint of the values that were tested: any edit makes it differ. */
function fingerprint(values: Partial<FormValues>): string {
  return JSON.stringify([
    values.host,
    values.port,
    values.security,
    values.username,
    values.password,
    values.fromEmail,
    values.fromName,
  ]);
}

export function SmtpSection({ smtp }: { smtp: SmtpSettingsPublic | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [hasPassword, setHasPassword] = useState(smtp?.hasPassword ?? false);
  const [verified, setVerified] = useState<{ key: string; sentTo: string } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(smtp),
  });
  const { control, handleSubmit, getValues, reset, trigger, formState } = form;
  // `watch()` re-renders on every edit, so the "tested" state is re-evaluated immediately.
  const current = fingerprint(useWatch({ control }));
  const isVerified = verified !== null && verified.key === current;

  const test = useMutation({
    mutationFn: (values: FormValues) => testSmtp(toRequest(values)),
    onSuccess: (response, values) => {
      setTestError(null);
      setSaveError(null);
      setVerified({ key: fingerprint(values), sentTo: response.sentTo });
    },
    onError: (error) => {
      setVerified(null);
      if (isApiError(error) && error.code === 'SMTP_TEST_FAILED') {
        const reason = error.details?.['reason'];
        setTestError(
          typeof reason === 'string' && /^[A-Za-z0-9_ .:-]{1,64}$/.test(reason)
            ? t('admin.settings.smtp.testFailedReason', { reason })
            : errorMessage(t, error),
        );
        return;
      }
      setTestError(errorMessage(t, error));
    },
  });

  const save = useMutation({
    mutationFn: (values: FormValues) => saveSmtp(toRequest(values)),
    onSuccess: async (response) => {
      setVerified(null);
      setSaveError(null);
      setHasPassword(response.hasPassword);
      reset(toFormValues(response));
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.settings });
      notifySuccess(t('admin.settings.savedToast'));
    },
    onError: (error) => setSaveError(errorMessage(t, error)),
  });

  const runTest = async () => {
    setTestError(null);
    setSaveError(null);
    if (!(await trigger())) return;
    test.mutate(getValues());
  };

  return (
    <form
      noValidate
      className="max-w-xl space-y-4"
      onSubmit={(event) =>
        void handleSubmit((values) => {
          setSaveError(null);
          if (fingerprint(getValues()) !== verified?.key) return;
          save.mutate(values);
        })(event)
      }
    >
      <FormErrorSummary
        errors={formState.errors}
        submitCount={formState.submitCount}
        idPrefix="smtp"
      />
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <TextField
          control={control}
          name="host"
          idPrefix="smtp"
          autoComplete="off"
          label={t('admin.settings.smtp.host')}
        />
        <TextField
          control={control}
          name="port"
          idPrefix="smtp"
          inputMode="numeric"
          autoComplete="off"
          label={t('admin.settings.smtp.port')}
        />
      </div>
      <FormField
        control={control}
        name="security"
        idPrefix="smtp"
        label={t('admin.settings.smtp.security')}
      >
        {({ field, controlProps }) => (
          <NativeSelect {...field} {...controlProps}>
            {SMTP_SECURITY.map((value) => (
              <option key={value} value={value}>
                {t(`admin.settings.smtp.securityOptions.${value}`)}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={control}
          name="username"
          idPrefix="smtp"
          autoComplete="off"
          optional
          label={t('admin.settings.smtp.username')}
        />
        <FormField
          control={control}
          name="password"
          idPrefix="smtp"
          optional
          label={t('admin.settings.smtp.password')}
          description={hasPassword ? t('admin.settings.smtp.passwordKept') : undefined}
        >
          {({ field, controlProps }) => (
            <PasswordInput
              autoComplete="new-password"
              placeholder={hasPassword ? '••••••••' : undefined}
              {...field}
              {...controlProps}
            />
          )}
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={control}
          name="fromEmail"
          idPrefix="smtp"
          type="email"
          autoComplete="off"
          label={t('admin.settings.smtp.fromEmail')}
        />
        <TextField
          control={control}
          name="fromName"
          idPrefix="smtp"
          autoComplete="off"
          optional
          label={t('admin.settings.smtp.fromName')}
        />
      </div>

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
