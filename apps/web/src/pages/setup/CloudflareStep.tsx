import type { CloudflareResponse } from '@easysend/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api/client';
import { setupCloudflare } from '@/lib/api/setup';
import { useZodForm } from '../auth/form-errors';
import { apiErrorText } from '../auth/helpers';
import { Notice } from '../auth/Notice';
import { CLOUDFLARE_FORM_DEFAULTS, cloudflareFormSchema } from '../settings-forms/cloudflare';
import { CloudflareFields, cloudflareFieldLabels } from '../settings-forms/CloudflareFields';
import { ExternalLink } from './ExternalLink';
import { StepHeading } from './StepHeading';
import { stepActionsClass, type StepProps } from './types';

const TOKENS_URL = 'https://dash.cloudflare.com/profile/api-tokens';

const HINTED_CODES = [
  'CLOUDFLARE_TOKEN_INVALID',
  'CLOUDFLARE_ZONE_NOT_FOUND',
  'CLOUDFLARE_RECORD_EXISTS',
  'CLOUDFLARE_API_ERROR',
];

export function CloudflareStep({ appMode, onFatal, onDone }: StepProps) {
  const { t } = useTranslation();

  if (appMode === 'local') {
    return (
      <div className="space-y-5">
        <StepHeading>{t('setup.cloudflare.title')}</StepHeading>
        <Notice tone="info" title={t('setup.cloudflare.skippedTitle')}>
          <p>{t('setup.cloudflare.skippedBody')}</p>
        </Notice>
        <div className={stepActionsClass}>
          <Button type="button" onClick={() => onDone()}>
            {t('common.actions.continue')}
          </Button>
        </div>
      </div>
    );
  }
  return <CloudflareForm onFatal={onFatal} onDone={onDone} />;
}

function CloudflareForm({ onFatal, onDone }: Pick<StepProps, 'onFatal' | 'onDone'>) {
  const { t } = useTranslation();
  const [error, setError] = useState<{ message: string; hint: string | null } | null>(null);
  const [result, setResult] = useState<CloudflareResponse | null>(null);
  const { control, handleSubmit, formState } = useZodForm(cloudflareFormSchema, {
    defaultValues: CLOUDFLARE_FORM_DEFAULTS,
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      setResult(await setupCloudflare(values));
    } catch (e) {
      if (onFatal(e)) return;
      const code = isApiError(e) ? e.code : '';
      setError({
        message: apiErrorText(t, e),
        hint: HINTED_CODES.includes(code) ? t(`setup.cloudflare.hints.${code}`) : null,
      });
    }
  });

  if (result) {
    return (
      <div className="space-y-5">
        <StepHeading>{t('setup.cloudflare.doneTitle')}</StepHeading>
        <Notice tone="success" title={t('setup.cloudflare.doneNotice')} role="status">
          <p>
            {t('setup.cloudflare.hostname')}: <code className="font-mono">{result.hostname}</code>
          </p>
          <p>
            {t('setup.cloudflare.publicUrl')}: <code className="font-mono">{result.publicUrl}</code>
          </p>
          <p>{t('setup.cloudflare.doneHint')}</p>
        </Notice>
        <div className={stepActionsClass}>
          <Button type="button" onClick={() => onDone({ publicUrl: result.publicUrl })}>
            {t('common.actions.continue')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <StepHeading description={t('setup.cloudflare.intro')}>
        {t('setup.cloudflare.title')}
      </StepHeading>
      <div className="bg-muted mb-6 space-y-2 p-4 text-sm">
        <p className="font-medium">{t('setup.cloudflare.tokenTitle')}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t('setup.cloudflare.permTunnel')}</li>
          <li>{t('setup.cloudflare.permDns')}</li>
          <li>{t('setup.cloudflare.permZone')}</li>
        </ul>
        <p className="text-muted-foreground">{t('setup.cloudflare.tokenNote')}</p>
        <ExternalLink href={TOKENS_URL}>{t('setup.cloudflare.createToken')}</ExternalLink>
      </div>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-5">
        <FormErrorSummary
          errors={formState.errors}
          submitCount={formState.submitCount}
          labels={cloudflareFieldLabels(t)}
        />
        {error ? (
          <Notice tone="error" title={error.message}>
            {error.hint ? <p>{error.hint}</p> : null}
            <p>{t('setup.cloudflare.retryNote')}</p>
          </Notice>
        ) : null}
        <CloudflareFields control={control} />
        <div className={stepActionsClass}>
          <Button type="submit" disabled={formState.isSubmitting}>
            {formState.isSubmitting
              ? t('setup.cloudflare.connecting')
              : error
                ? t('common.actions.retry')
                : t('setup.cloudflare.submit')}
          </Button>
        </div>
      </form>
    </div>
  );
}
