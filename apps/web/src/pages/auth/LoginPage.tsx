import { emailSchema, loginRecoveryRequestSchema, loginRequestSchema } from '@easysend/shared';
import type { User } from '@easysend/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { useSession } from '@/app/providers/SessionProvider';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField, TextField } from '@/components/common/FormField';
import { OtpInput } from '@/components/common/OtpInput';
import { PageHeader } from '@/components/common/PageHeader';
import { PasswordInput } from '@/components/common/PasswordInput';
import { PublicCard } from '@/components/layout/PublicLayout';
import { Button } from '@/components/ui/button';
import { login, login2fa, login2faSetup, login2faSetupVerify, loginRecovery } from '@/lib/api/auth';
import { hasErrorCode } from '@/lib/errors';
import { useZodForm } from './form-errors';
import { apiErrorText, safeReturnTo } from './helpers';
import { Notice } from './Notice';
import { RecoveryCodesStep } from './RecoveryCodesStep';
import { TwoFactorEnrollment } from './TwoFactorEnrollment';

type Step =
  | { name: 'password' }
  | { name: 'otp' }
  | { name: 'recovery' }
  | { name: 'enroll'; secret: string; otpauthUri: string }
  | { name: 'enrollCodes'; user: User; codes: string[] }
  | { name: 'lowCodes'; user: User; left: number };

const linkClass =
  'text-primary inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline';

const passwordFormSchema = loginRequestSchema.extend({
  email: z.string().trim().pipe(emailSchema),
});

const recoveryFormSchema = z.object({
  recoveryCode: z.string().trim().pipe(loginRecoveryRequestSchema.shape.recoveryCode),
});

export default function LoginPage() {
  const { t } = useTranslation();
  const { user, setSessionUser } = useSession();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [notice, setNotice] = useState<string | null>(null);

  // Everything that completes the login ends here: the redirect below does the navigation.
  const finish = (next: User) => setSessionUser(next);

  if (user) return <Navigate to={returnTo} replace />;

  const backToPassword = (message: string | null = null) => {
    setNotice(message);
    setStep({ name: 'password' });
  };

  const width = step.name === 'enroll' || step.name === 'enrollCodes' ? 'default' : 'narrow';

  return (
    <PublicCard width={width}>
      {step.name === 'password' ? (
        <>
          <PageHeader key="password" title={t('auth.title')} description={t('auth.subtitle')} />
          <PasswordStep
            notice={notice}
            onOtp={() => {
              setNotice(null);
              setStep({ name: 'otp' });
            }}
            onEnroll={(secret, otpauthUri) => {
              setNotice(null);
              setStep({ name: 'enroll', secret, otpauthUri });
            }}
            onDone={finish}
          />
        </>
      ) : null}

      {step.name === 'otp' ? (
        <>
          <PageHeader key="otp" title={t('auth.twoFactorTitle')} description={t('auth.otpHint')} />
          <OtpStep
            onDone={finish}
            onRecovery={() => setStep({ name: 'recovery' })}
            onExpired={() => backToPassword(t('auth.sessionExpired'))}
            onCancel={() => backToPassword()}
          />
        </>
      ) : null}

      {step.name === 'recovery' ? (
        <>
          <PageHeader
            key="recovery"
            title={t('auth.recoveryTitle')}
            description={t('auth.recoveryHint')}
          />
          <RecoveryStep
            onDone={(next, left) =>
              left === undefined ? finish(next) : setStep({ name: 'lowCodes', user: next, left })
            }
            onOtp={() => setStep({ name: 'otp' })}
            onExpired={() => backToPassword(t('auth.sessionExpired'))}
            onCancel={() => backToPassword()}
          />
        </>
      ) : null}

      {step.name === 'enroll' ? (
        <>
          <PageHeader
            key="enroll"
            title={t('auth.enrollTitle')}
            description={t('auth.enrollDescription')}
          />
          <TwoFactorEnrollment
            secret={step.secret}
            otpauthUri={step.otpauthUri}
            onVerify={async (code) => {
              try {
                const res = await login2faSetupVerify({ code });
                setStep({ name: 'enrollCodes', user: res.user, codes: res.recoveryCodes });
              } catch (e) {
                if (hasErrorCode(e, 'UNAUTHENTICATED')) {
                  backToPassword(t('auth.sessionExpired'));
                  return;
                }
                throw e;
              }
            }}
          />
          <div className="mt-6">
            <CancelButton onCancel={() => backToPassword()} />
          </div>
        </>
      ) : null}

      {step.name === 'enrollCodes' ? (
        <>
          <PageHeader
            key="enrollCodes"
            title={t('auth.enrollDoneTitle')}
            description={t('auth.enrollDoneDescription')}
          />
          <RecoveryCodesStep
            codes={step.codes}
            onContinue={() => finish(step.user)}
            continueLabel={t('auth.finishSignIn')}
          />
        </>
      ) : null}

      {step.name === 'lowCodes' ? (
        <>
          <PageHeader key="lowCodes" title={t('auth.lowCodesTitle')} />
          <div className="space-y-6">
            <Notice tone="warning" title={t('auth.lowCodesNotice', { count: step.left })}>
              <p>{step.left === 0 ? t('auth.lowCodesNone') : t('auth.lowCodesBody')}</p>
            </Notice>
            <Button type="button" className="w-full sm:w-auto" onClick={() => finish(step.user)}>
              {t('auth.finishSignIn')}
            </Button>
          </div>
        </>
      ) : null}
    </PublicCard>
  );
}

function CancelButton({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const { logout } = useSession();
  return (
    <Button
      type="button"
      variant="link"
      className="h-11 px-0"
      onClick={() => {
        // Closes the half-open session; a failure does not matter here.
        void logout().catch(() => undefined);
        onCancel();
      }}
    >
      {t('auth.cancelSignIn')}
    </Button>
  );
}

function PasswordStep({
  notice,
  onOtp,
  onEnroll,
  onDone,
}: {
  notice: string | null;
  onOtp: () => void;
  onEnroll: (secret: string, otpauthUri: string) => void;
  onDone: (user: User) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(passwordFormSchema, {
    defaultValues: { email: '', password: '' },
  });
  const { control, handleSubmit, formState } = form;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await login(values);
      if (res.status === 'ok') {
        onDone(res.user);
      } else if (res.status === 'mfa_required') {
        onOtp();
      } else {
        const setup = await login2faSetup();
        onEnroll(setup.secret, setup.otpauthUri);
      }
    } catch (e) {
      setError(apiErrorText(t, e));
    }
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-5">
      {notice ? <Notice tone="info">{notice}</Notice> : null}
      <FormErrorSummary
        errors={formState.errors}
        submitCount={formState.submitCount}
        labels={{ email: t('auth.email'), password: t('auth.password') }}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <TextField
        control={control}
        name="email"
        label={t('auth.email')}
        type="email"
        autoComplete="username"
        inputMode="email"
      />
      <FormField control={control} name="password" label={t('auth.password')}>
        {({ field, controlProps }) => (
          <PasswordInput autoComplete="current-password" {...field} {...controlProps} />
        )}
      </FormField>
      <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
      </Button>
      <p>
        <Link to="/forgot-password" className={linkClass}>
          {t('auth.forgotLink')}
        </Link>
      </p>
    </form>
  );
}

function OtpStep({
  onDone,
  onRecovery,
  onExpired,
  onCancel,
}: {
  onDone: (user: User) => void;
  onRecovery: () => void;
  onExpired: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (value: string) => {
    if (pending || value.length !== 6) return;
    setPending(true);
    setError(null);
    try {
      const res = await login2fa({ code: value });
      onDone(res.user);
    } catch (e) {
      if (hasErrorCode(e, 'UNAUTHENTICATED')) {
        onExpired();
        return;
      }
      setError(apiErrorText(t, e));
      setCode('');
      setPending(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <label htmlFor="login-otp" className="block text-sm font-medium">
          {t('auth.otpLabel')}
        </label>
        <OtpInput
          id="login-otp"
          aria-label={t('auth.otpLabel')}
          value={code}
          onChange={setCode}
          onComplete={(value) => void submit(value)}
          disabled={pending}
          aria-describedby={error ? 'login-otp-error' : undefined}
          aria-invalid={error ? true : undefined}
        />
        {error ? (
          <p id="login-otp-error" role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <div aria-live="polite" className="text-muted-foreground min-h-5 text-sm">
          {pending ? t('auth.verifying') : ''}
        </div>
      </div>
      <Button
        type="button"
        className="w-full"
        disabled={pending || code.length !== 6}
        onClick={() => void submit(code)}
      >
        {t('auth.verify')}
      </Button>
      <div className="flex flex-col items-start">
        <Button type="button" variant="link" className="h-11 px-0" onClick={onRecovery}>
          {t('auth.useRecoveryCode')}
        </Button>
        <CancelButton onCancel={onCancel} />
      </div>
    </div>
  );
}

function RecoveryStep({
  onDone,
  onOtp,
  onExpired,
  onCancel,
}: {
  onDone: (user: User, codesLeft: number | undefined) => void;
  onOtp: () => void;
  onExpired: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(recoveryFormSchema, {
    defaultValues: { recoveryCode: '' },
  });
  const { control, handleSubmit, formState } = form;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await loginRecovery(values);
      onDone(res.user, res.recoveryCodesLeft);
    } catch (e) {
      if (hasErrorCode(e, 'UNAUTHENTICATED')) {
        onExpired();
        return;
      }
      setError(apiErrorText(t, e));
    }
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-5">
      <FormErrorSummary
        errors={formState.errors}
        submitCount={formState.submitCount}
        labels={{ recoveryCode: t('auth.recoveryCode') }}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <TextField
        control={control}
        name="recoveryCode"
        label={t('auth.recoveryCode')}
        description={t('auth.recoveryFormat')}
        autoComplete="off"
      />
      <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? t('auth.verifying') : t('auth.verify')}
      </Button>
      <div className="flex flex-col items-start">
        <Button type="button" variant="link" className="h-11 px-0" onClick={onOtp}>
          {t('auth.useAuthenticator')}
        </Button>
        <CancelButton onCancel={onCancel} />
      </div>
    </form>
  );
}
