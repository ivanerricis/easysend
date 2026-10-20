import {
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  emailSchema,
  passwordSchema,
  setupAdminRequestSchema,
} from '@easysend/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useSession } from '@/app/providers/SessionProvider';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField, TextField } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';
import { Button } from '@/components/ui/button';
import { createSetupAdmin, verifySetupAdmin } from '@/lib/api/setup';
import { hasErrorCode } from '@/lib/errors';
import { useZodForm } from '../auth/form-errors';
import { apiErrorText } from '../auth/helpers';
import { Notice } from '../auth/Notice';
import { RecoveryCodesStep } from '../auth/RecoveryCodesStep';
import { TwoFactorEnrollment } from '../auth/TwoFactorEnrollment';
import { StepHeading } from './StepHeading';
import { stepActionsClass, type StepProps } from './types';

const formSchema = z
  .object({
    email: z.string().trim().pipe(emailSchema),
    displayName: z.string().trim().max(DISPLAY_NAME_MAX_LENGTH),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'auth.errors.passwordMismatch',
  })
  .transform((v) => ({
    email: v.email,
    ...(v.displayName === '' ? {} : { displayName: v.displayName }),
    password: v.password,
  }))
  .pipe(setupAdminRequestSchema);

type Phase =
  | { name: 'form' }
  | { name: 'enroll'; secret: string; otpauthUri: string }
  | { name: 'codes'; codes: string[] }
  | { name: 'exists' };

export function AdminStep({ onFatal, onDone }: StepProps) {
  const { t } = useTranslation();
  const { setSessionUser } = useSession();
  const [phase, setPhase] = useState<Phase>({ name: 'form' });
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  if (phase.name === 'exists') {
    return (
      <div className="space-y-5">
        <StepHeading>{t('setup.admin.existsTitle')}</StepHeading>
        <Notice tone="info">
          <p>{t('setup.admin.existsBody')}</p>
        </Notice>
        <div className={stepActionsClass}>
          <Button type="button" onClick={() => onDone()}>
            {t('common.actions.continue')}
          </Button>
        </div>
      </div>
    );
  }

  if (phase.name === 'enroll') {
    return (
      <div>
        <StepHeading description={t('setup.admin.enrollIntro')}>
          {t('setup.admin.enrollTitle')}
        </StepHeading>
        <TwoFactorEnrollment
          secret={phase.secret}
          otpauthUri={phase.otpauthUri}
          onVerify={async (code) => {
            try {
              const res = await verifySetupAdmin({ code });
              // The browser now holds the admin session of the new account.
              setSessionUser(res.user);
              setPhase({ name: 'codes', codes: res.recoveryCodes });
            } catch (e) {
              if (onFatal(e)) return;
              if (hasErrorCode(e, 'CONFLICT')) {
                setNotice(t('setup.admin.enrollLost'));
                setPhase({ name: 'form' });
                return;
              }
              throw e;
            }
          }}
        />
      </div>
    );
  }

  if (phase.name === 'codes') {
    return (
      <div>
        <StepHeading description={t('setup.admin.codesIntro')}>
          {t('setup.admin.codesTitle')}
        </StepHeading>
        <RecoveryCodesStep codes={phase.codes} onContinue={() => onDone({ adminEmail: email })} />
      </div>
    );
  }

  return (
    <AdminForm
      notice={notice}
      onFatal={onFatal}
      onExists={() => setPhase({ name: 'exists' })}
      onCreated={(address, secret, otpauthUri) => {
        setEmail(address);
        setNotice(null);
        setPhase({ name: 'enroll', secret, otpauthUri });
      }}
    />
  );
}

function AdminForm({
  notice,
  onFatal,
  onExists,
  onCreated,
}: {
  notice: string | null;
  onFatal: (error: unknown) => boolean;
  onExists: () => void;
  onCreated: (email: string, secret: string, otpauthUri: string) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useZodForm(formSchema, {
    defaultValues: { email: '', displayName: '', password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await createSetupAdmin(values);
      onCreated(values.email, res.secret, res.otpauthUri);
    } catch (e) {
      if (onFatal(e)) return;
      if (hasErrorCode(e, 'CONFLICT')) {
        onExists();
        return;
      }
      setError(apiErrorText(t, e));
    }
  });

  return (
    <div>
      <StepHeading description={t('setup.admin.intro')}>{t('setup.admin.title')}</StepHeading>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-5">
        {notice ? <Notice tone="warning">{notice}</Notice> : null}
        <FormErrorSummary
          errors={formState.errors}
          submitCount={formState.submitCount}
          labels={{
            email: t('auth.email'),
            displayName: t('setup.admin.displayName'),
            password: t('auth.password'),
            confirmPassword: t('auth.confirmPassword'),
          }}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <TextField
          control={control}
          name="email"
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          inputMode="email"
        />
        <TextField
          control={control}
          name="displayName"
          label={t('setup.admin.displayName')}
          description={t('setup.admin.displayNameHint')}
          optional
          autoComplete="name"
          maxLength={DISPLAY_NAME_MAX_LENGTH}
        />
        <FormField
          control={control}
          name="password"
          label={t('auth.password')}
          description={t('auth.passwordRule', { count: PASSWORD_MIN_LENGTH })}
        >
          {({ field, controlProps }) => (
            <PasswordInput autoComplete="new-password" {...field} {...controlProps} />
          )}
        </FormField>
        <FormField control={control} name="confirmPassword" label={t('auth.confirmPassword')}>
          {({ field, controlProps }) => (
            <PasswordInput autoComplete="new-password" {...field} {...controlProps} />
          )}
        </FormField>
        <div className={stepActionsClass}>
          <Button type="submit" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? t('common.actions.working') : t('setup.admin.submit')}
          </Button>
        </div>
      </form>
    </div>
  );
}
