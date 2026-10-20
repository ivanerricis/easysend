import { cloudflareRequestSchema, type CloudflareResponse } from '@easysend/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField, TextField } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api/client';
import { setupCloudflare } from '@/lib/api/setup';
import { useZodForm } from '../auth/form-errors';
import { apiErrorText } from '../auth/helpers';
import { Notice } from '../auth/Notice';
import { ExternalLink } from './ExternalLink';
import { StepHeading } from './StepHeading';
import { stepActionsClass, type StepProps } from './types';

const TOKENS_URL = 'https://dash.cloudflare.com/profile/api-tokens';

const formSchema = z
  .object({ domain: z.string(), subdomain: z.string(), apiToken: z.string() })
  .transform((v) => ({
    domain: v.domain.trim().toLowerCase(),
    ...(v.subdomain.trim() === '' ? {} : { subdomain: v.subdomain.trim().toLowerCase() }),
    apiToken: v.apiToken.trim(),
  }))
  .pipe(cloudflareRequestSchema);

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
  const { control, handleSubmit, formState } = useZodForm(formSchema, {
    defaultValues: { domain: '', subdomain: '', apiToken: '' },
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
          labels={{
            domain: t('setup.cloudflare.domain'),
            subdomain: t('setup.cloudflare.subdomain'),
            apiToken: t('setup.cloudflare.apiToken'),
          }}
        />
        {error ? (
          <Notice tone="error" title={error.message}>
            {error.hint ? <p>{error.hint}</p> : null}
            <p>{t('setup.cloudflare.retryNote')}</p>
          </Notice>
        ) : null}
        <TextField
          control={control}
          name="domain"
          label={t('setup.cloudflare.domain')}
          description={t('setup.cloudflare.domainHint')}
          placeholder="example.com"
          autoComplete="off"
        />
        <TextField
          control={control}
          name="subdomain"
          label={t('setup.cloudflare.subdomain')}
          description={t('setup.cloudflare.subdomainHint')}
          placeholder="files"
          optional
          autoComplete="off"
        />
        <FormField
          control={control}
          name="apiToken"
          label={t('setup.cloudflare.apiToken')}
          description={t('setup.cloudflare.apiTokenHint')}
        >
          {({ field, controlProps }) => (
            <PasswordInput autoComplete="off" spellCheck={false} {...field} {...controlProps} />
          )}
        </FormField>
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
