import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@easysend/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useSession } from '@/app/providers/SessionProvider';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';
import { Button } from '@/components/ui/button';
import { changePassword } from '@/lib/api/me';
import { errorMessage, hasErrorCode } from '@/lib/errors';
import { notifySuccess } from '@/lib/toast';
import { NewPasswordFields } from '../auth/NewPasswordFields';
import { withPasswordConfirmation } from '../auth/password-confirmation';
import { lockMessage } from './lock-message';
import { Section } from './Section';

// Same bounds as `changePasswordRequestSchema`, with translatable messages and the
// client-only confirmation field.
const passwordFormSchema = withPasswordConfirmation(
  z.object({
    currentPassword: z
      .string()
      .min(1, 'profile.password.errors.currentRequired')
      .max(PASSWORD_MAX_LENGTH),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, 'profile.password.errors.tooShort')
      .max(PASSWORD_MAX_LENGTH, 'profile.password.errors.tooLong'),
    confirmPassword: z.string().min(1, 'profile.password.errors.confirmRequired'),
  }),
  'newPassword',
);
type PasswordForm = z.infer<typeof passwordFormSchema>;

export function PasswordSection() {
  const { t, i18n } = useTranslation();
  const { refresh } = useSession();
  const [formError, setFormError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const {
    control,
    handleSubmit,
    reset,
    setError,
    setFocus,
    formState: { errors, submitCount, isSubmitting },
  } = useForm<PasswordForm>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setFormError(null);
    setChanged(false);
    try {
      await changePassword({ currentPassword, newPassword });
      reset();
      setChanged(true);
      notifySuccess(t('profile.password.success'));
      // The session id rotated: pick up the new session / CSRF state.
      await refresh();
    } catch (error) {
      if (hasErrorCode(error, 'PASSWORD_INCORRECT')) {
        setError('currentPassword', { message: errorMessage(t, error) });
        setFocus('currentPassword');
      } else if (hasErrorCode(error, 'RATE_LIMITED', 'ACCOUNT_LOCKED')) {
        setFormError(lockMessage(t, i18n.language, error));
      } else {
        setFormError(errorMessage(t, error));
      }
    }
  });

  return (
    <Section title={t('profile.password.title')} description={t('profile.password.description')}>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        <FormErrorSummary errors={errors} submitCount={submitCount} idPrefix="password" />
        <FormField
          control={control}
          name="currentPassword"
          idPrefix="password"
          label={t('profile.password.current')}
        >
          {({ field, controlProps }) => (
            <PasswordInput autoComplete="current-password" {...field} {...controlProps} />
          )}
        </FormField>
        <NewPasswordFields
          control={control}
          idPrefix="password"
          label={t('profile.password.new')}
          description={t('profile.password.newHelp', { min: PASSWORD_MIN_LENGTH })}
          confirmLabel={t('profile.password.confirm')}
        />
        {formError ? (
          <p role="alert" className="text-destructive text-sm">
            {formError}
          </p>
        ) : null}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('profile.password.submitting') : t('profile.password.submit')}
        </Button>
        <p role="status" className="text-sm">
          {changed ? t('profile.password.sessionsNote') : ''}
        </p>
      </form>
    </Section>
  );
}
