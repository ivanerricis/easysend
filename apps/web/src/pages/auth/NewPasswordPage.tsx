import { PASSWORD_MIN_LENGTH, passwordSchema } from '@easysend/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { PasswordInput } from '@/components/common/PasswordInput';
import { PublicCard } from '@/components/layout/PublicLayout';
import { Button } from '@/components/ui/button';
import { confirmPasswordReset } from '@/lib/api/auth';
import { hasErrorCode } from '@/lib/errors';
import { useZodForm } from './form-errors';
import { apiErrorText } from './helpers';
import { Notice } from './Notice';

const formSchema = z
  .object({ newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'auth.errors.passwordMismatch',
  });

const linkClass =
  'text-primary inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline';

interface NewPasswordPageProps {
  /** `reset`: forgotten password; `welcome`: first password of an account created by an admin. */
  variant: 'reset' | 'welcome';
}

/** Shared page of `/reset-password` and `/welcome`: choose a new password with an emailed token. */
export function NewPasswordPage({ variant }: NewPasswordPageProps) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useZodForm(formSchema, {
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await confirmPasswordReset({ token, newPassword: values.newPassword });
      setDone(true);
    } catch (e) {
      if (hasErrorCode(e, 'RESET_TOKEN_INVALID')) setInvalid(true);
      else setError(apiErrorText(t, e));
    }
  });

  if (token === '' || invalid) {
    return (
      <PublicCard width="narrow">
        <PageHeader key="invalid" title={t(`auth.${variant}.invalidTitle`)} />
        <div className="space-y-5">
          <Notice tone="error" role="none">
            <p>{t(`auth.${variant}.invalidBody`)}</p>
          </Notice>
          <Link to={variant === 'reset' ? '/forgot-password' : '/login'} className={linkClass}>
            {variant === 'reset' ? t('auth.requestNewLink') : t('auth.backToLogin')}
          </Link>
          {variant === 'welcome' ? (
            <p className="text-muted-foreground text-sm">{t('auth.welcome.invalidHelp')}</p>
          ) : null}
        </div>
      </PublicCard>
    );
  }

  if (done) {
    return (
      <PublicCard width="narrow">
        <PageHeader key="done" title={t(`auth.${variant}.doneTitle`)} />
        <div className="space-y-5">
          <Notice tone="success">
            <p>{t(`auth.${variant}.doneBody`)}</p>
          </Notice>
          <Button asChild className="w-full">
            <Link to="/login">{t('auth.goToLogin')}</Link>
          </Button>
        </div>
      </PublicCard>
    );
  }

  return (
    <PublicCard width="narrow">
      <PageHeader
        key="form"
        title={t(`auth.${variant}.title`)}
        description={t(`auth.${variant}.description`)}
      />
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-5">
        <FormErrorSummary
          errors={formState.errors}
          submitCount={formState.submitCount}
          labels={{
            newPassword: t('auth.newPassword'),
            confirmPassword: t('auth.confirmPassword'),
          }}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <FormField
          control={control}
          name="newPassword"
          label={t('auth.newPassword')}
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
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? t('common.actions.saving') : t(`auth.${variant}.submit`)}
        </Button>
      </form>
    </PublicCard>
  );
}
