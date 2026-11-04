import { PASSWORD_MAX_LENGTH } from '@easysend/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { PasswordInput } from '@/components/common/PasswordInput';
import { PublicCard } from '@/components/layout/PublicLayout';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api/client';
import { hasErrorCode } from '@/lib/errors';
import { formatDuration } from '@/lib/format';

const unlockFormSchema = z.object({
  password: z.string().min(1, 'download.locked.required').max(PASSWORD_MAX_LENGTH),
});
type UnlockForm = z.infer<typeof unlockFormSchema>;

interface UnlockCardProps {
  title: string;
  description: string;
  /** Line under the field, e.g. "Available until ...". */
  expiresLabel: string;
  /** Sends the password; a wrong one must reject with `PASSWORD_INCORRECT`. */
  unlock: (password: string) => Promise<unknown>;
  /** Reloads the page data after the unlock (or after an unexpected failure). */
  onUnlocked: () => Promise<unknown>;
}

/**
 * Password form of a protected public link (downloads and upload requests): inline errors,
 * focus back to the field on a wrong password, retry time on rate limit.
 */
export function UnlockCard({
  title,
  description,
  expiresLabel,
  unlock,
  onUnlocked,
}: UnlockCardProps) {
  const { t, i18n } = useTranslation();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setFocus,
    formState: { errors, submitCount, isSubmitting },
  } = useForm<UnlockForm>({
    resolver: zodResolver(unlockFormSchema),
    defaultValues: { password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await unlock(values.password);
      await onUnlocked();
    } catch (error) {
      if (hasErrorCode(error, 'PASSWORD_INCORRECT')) {
        setServerError(t('errors.PASSWORD_INCORRECT'));
        setFocus('password');
      } else if (hasErrorCode(error, 'RATE_LIMITED') && isApiError(error)) {
        setServerError(
          error.retryAfter
            ? t('download.locked.retryIn', {
                time: formatDuration(error.retryAfter, i18n.language),
              })
            : t('errors.RATE_LIMITED'),
        );
      } else {
        // Expired, revoked, deleted...: reload the info to show the matching state.
        await onUnlocked();
      }
    }
  });

  return (
    <PublicCard width="narrow">
      <PageHeader title={title} description={description} />
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        <FormErrorSummary errors={errors} submitCount={submitCount} />
        <FormField control={control} name="password" label={t('download.locked.password')}>
          {({ field, controlProps }) => (
            <PasswordInput
              autoComplete="off"
              {...field}
              {...controlProps}
              aria-invalid={controlProps['aria-invalid'] || serverError !== null}
              aria-describedby={
                [controlProps['aria-describedby'], serverError ? 'unlock-error' : undefined]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
            />
          )}
        </FormField>
        {serverError ? (
          <p id="unlock-error" role="alert" className="text-destructive text-sm">
            {serverError}
          </p>
        ) : null}
        <p className="text-muted-foreground text-sm">{expiresLabel}</p>
        <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
          <Lock aria-hidden="true" />
          {isSubmitting ? t('download.locked.submitting') : t('download.locked.submit')}
        </Button>
      </form>
    </PublicCard>
  );
}
