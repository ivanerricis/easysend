import { passwordResetRequestSchema } from '@easysend/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { TextField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { PublicCard } from '@/components/layout/PublicLayout';
import { Button } from '@/components/ui/button';
import { requestPasswordReset } from '@/lib/api/auth';
import { useZodForm } from './form-errors';
import { apiErrorText } from './helpers';
import { Notice } from './Notice';

const formSchema = passwordResetRequestSchema.extend({
  email: z.string().trim().pipe(passwordResetRequestSchema.shape.email),
});

const linkClass =
  'text-primary inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline';

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useZodForm(formSchema, {
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await requestPasswordReset(values);
      setSentTo(values.email);
    } catch (e) {
      setError(apiErrorText(t, e));
    }
  });

  if (sentTo !== null) {
    return (
      <PublicCard width="narrow">
        <PageHeader key="sent" title={t('auth.forgotSentTitle')} />
        <div className="space-y-5">
          <Notice tone="success">
            <p>{t('auth.forgotSentBody', { email: sentTo })}</p>
            <p>{t('auth.forgotSentSpam')}</p>
          </Notice>
          <Link to="/login" className={linkClass}>
            {t('auth.backToLogin')}
          </Link>
        </div>
      </PublicCard>
    );
  }

  return (
    <PublicCard width="narrow">
      <PageHeader
        key="form"
        title={t('auth.forgotTitle')}
        description={t('auth.forgotDescription')}
      />
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-5">
        <FormErrorSummary
          errors={formState.errors}
          submitCount={formState.submitCount}
          labels={{ email: t('auth.email') }}
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
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? t('common.actions.working') : t('auth.forgotSubmit')}
        </Button>
        <p>
          <Link to="/login" className={linkClass}>
            {t('auth.backToLogin')}
          </Link>
        </p>
      </form>
    </PublicCard>
  );
}
