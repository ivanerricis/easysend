import { setupCodeRequestSchema } from '@easysend/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { CopyButton } from '@/components/common/CopyButton';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { TextField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { submitSetupCode } from '@/lib/api/setup';
import { hasErrorCode } from '@/lib/errors';
import { useZodForm } from '../auth/form-errors';
import { apiErrorText } from '../auth/helpers';
import { Notice } from '../auth/Notice';
import { StepHeading } from './StepHeading';
import { stepActionsClass, type StepProps } from './types';

const formSchema = z.object({ code: z.string().pipe(setupCodeRequestSchema.shape.code) });

/** `abcd efgh 2345` / `ABCD-EFGH-2345` / `abcdefgh2345` all become `ABCD-EFGH-2345`. */
export function normalizeSetupCode(raw: string): string {
  const compact = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return compact.length === 12 ? (compact.match(/.{4}/g) ?? []).join('-') : raw.trim();
}

interface CodeStepProps extends StepProps {
  /** Shown above the form, e.g. "the setup session expired". */
  notice?: string | null;
}

export function CodeStep({ appMode, onFatal, onDone, notice }: CodeStepProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const command =
    appMode === 'local' ? 'docker compose -p easysend-local logs api' : 'docker compose logs api';
  const {
    control,
    handleSubmit,
    formState,
    setError: setFieldError,
  } = useZodForm(formSchema, {
    defaultValues: { code: '' },
  });

  const onSubmit = handleSubmit(async ({ code }) => {
    setError(null);
    try {
      await submitSetupCode({ code: normalizeSetupCode(code) });
      onDone();
    } catch (e) {
      if (onFatal(e)) return;
      if (hasErrorCode(e, 'SETUP_CODE_INVALID')) {
        setFieldError('code', { type: 'server', message: t('setup.code.invalid') });
      } else if (hasErrorCode(e, 'SETUP_CODE_EXPIRED')) {
        setError(t('setup.code.expired'));
      } else {
        setError(apiErrorText(t, e));
      }
    }
  });

  return (
    <div>
      <StepHeading description={t('setup.code.intro')}>{t('setup.code.title')}</StepHeading>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-5">
        {notice ? <Notice tone="warning">{notice}</Notice> : null}
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('setup.code.whereTitle')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="bg-muted min-w-0 px-3 py-2 font-mono text-sm break-all">
              {command}
            </code>
            <CopyButton value={command} toast={false}>
              {t('setup.code.copyCommand')}
            </CopyButton>
          </div>
          <p className="text-muted-foreground text-sm">
            {t(appMode === 'local' ? 'setup.code.whereLocal' : 'setup.code.whereProduction')}
          </p>
        </div>
        <FormErrorSummary
          errors={formState.errors}
          submitCount={formState.submitCount}
          labels={{ code: t('setup.code.label') }}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <TextField
          control={control}
          name="code"
          label={t('setup.code.label')}
          description={t('setup.code.format')}
          autoComplete="off"
          maxLength={32}
        />
        <div className={stepActionsClass}>
          <Button type="submit" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? t('setup.code.checking') : t('setup.code.submit')}
          </Button>
        </div>
      </form>
    </div>
  );
}
