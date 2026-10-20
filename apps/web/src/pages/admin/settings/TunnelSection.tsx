import { zodResolver } from '@hookform/resolvers/zod';
import { domainSchema, subdomainSchema, type TunnelStatusResponse } from '@easysend/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Info } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { queryKeys } from '@/app/query';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField, TextField } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { setTunnel } from '@/lib/api/admin';
import { errorMessage, hasErrorCode } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { notifySuccess } from '@/lib/toast';

const formSchema = z.object({
  domain: z
    .string()
    .trim()
    .refine((value) => domainSchema.safeParse(value).success, {
      error: 'admin.settings.tunnel.errors.domain',
    }),
  subdomain: z
    .string()
    .trim()
    .refine((value) => value === '' || subdomainSchema.safeParse(value).success, {
      error: 'admin.settings.tunnel.errors.subdomain',
    }),
  apiToken: z
    .string()
    .trim()
    .min(20, { error: 'admin.settings.tunnel.errors.token' })
    .max(256, { error: 'admin.settings.tunnel.errors.token' }),
});
type FormValues = z.infer<typeof formSchema>;

export function TunnelSection({ tunnel }: { tunnel: TunnelStatusResponse }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { refresh } = useAppearance();
  const isLocal = tunnel.appMode === 'local';
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { domain: '', subdomain: '', apiToken: '' },
  });
  const { control, handleSubmit, setError, setValue, formState } = form;

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      setTunnel({
        domain: values.domain,
        ...(values.subdomain ? { subdomain: values.subdomain } : {}),
        apiToken: values.apiToken,
      }),
    onSuccess: async (response) => {
      setValue('apiToken', '');
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.tunnel });
      await refresh();
      notifySuccess(t('admin.settings.tunnel.savedToast', { url: response.publicUrl }));
    },
    onError: (error) => {
      // The token is never kept in the form after an attempt.
      setValue('apiToken', '');
      setFormError(null);
      if (hasErrorCode(error, 'CLOUDFLARE_TOKEN_INVALID')) {
        setError('apiToken', { type: 'server', message: errorMessage(t, error) });
      } else if (hasErrorCode(error, 'CLOUDFLARE_ZONE_NOT_FOUND')) {
        setError('domain', { type: 'server', message: errorMessage(t, error) });
      } else if (hasErrorCode(error, 'CLOUDFLARE_RECORD_EXISTS')) {
        setError('subdomain', { type: 'server', message: errorMessage(t, error) });
      } else {
        setFormError(errorMessage(t, error));
      }
    },
  });

  return (
    <div className="max-w-xl space-y-4">
      {isLocal ? (
        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>{t('admin.settings.tunnel.localTitle')}</AlertTitle>
          <AlertDescription>{t('admin.settings.tunnel.localBody')}</AlertDescription>
        </Alert>
      ) : (
        <dl className="ring-foreground/10 grid gap-x-6 gap-y-2 p-4 text-sm ring-1 sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">{t('admin.settings.tunnel.status')}</dt>
          <dd className="flex items-center gap-1.5 font-medium">
            {tunnel.configured ? (
              <>
                <CheckCircle2 aria-hidden="true" className="size-4" />
                {t('admin.settings.tunnel.configured')}
              </>
            ) : (
              t('admin.settings.tunnel.notConfigured')
            )}
          </dd>
          {tunnel.hostname ? (
            <>
              <dt className="text-muted-foreground">{t('admin.settings.tunnel.hostname')}</dt>
              <dd className="font-mono break-all">{tunnel.hostname}</dd>
            </>
          ) : null}
          {tunnel.publicUrl ? (
            <>
              <dt className="text-muted-foreground">{t('admin.settings.tunnel.publicUrl')}</dt>
              <dd className="font-mono break-all">{tunnel.publicUrl}</dd>
            </>
          ) : null}
          {tunnel.configuredAt ? (
            <>
              <dt className="text-muted-foreground">{t('admin.settings.tunnel.configuredAt')}</dt>
              <dd>{formatDateTime(tunnel.configuredAt, i18n.language)}</dd>
            </>
          ) : null}
        </dl>
      )}

      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) =>
          void handleSubmit((values) => {
            setFormError(null);
            mutation.mutate(values);
          })(event)
        }
      >
        <FormErrorSummary
          errors={formState.errors}
          submitCount={formState.submitCount}
          idPrefix="tunnel"
        />
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <fieldset disabled={isLocal} className="space-y-4">
          <TextField
            control={control}
            name="domain"
            idPrefix="tunnel"
            autoComplete="off"
            placeholder="example.com"
            label={t('admin.settings.tunnel.domain')}
            description={t('admin.settings.tunnel.domainHelp')}
          />
          <TextField
            control={control}
            name="subdomain"
            idPrefix="tunnel"
            autoComplete="off"
            optional
            placeholder="send"
            label={t('admin.settings.tunnel.subdomain')}
            description={t('admin.settings.tunnel.subdomainHelp')}
          />
          <FormField
            control={control}
            name="apiToken"
            idPrefix="tunnel"
            label={t('admin.settings.tunnel.apiToken')}
            description={t('admin.settings.tunnel.apiTokenHelp')}
          >
            {({ field, controlProps }) => (
              <PasswordInput autoComplete="off" spellCheck={false} {...field} {...controlProps} />
            )}
          </FormField>

          <div className="space-y-2 text-sm">
            <p className="font-medium">{t('admin.settings.tunnel.permissionsTitle')}</p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5">
              <li>{t('admin.settings.tunnel.permTunnel')}</li>
              <li>{t('admin.settings.tunnel.permDns')}</li>
              <li>{t('admin.settings.tunnel.permZone')}</li>
            </ul>
            <a
              href="https://dash.cloudflare.com/profile/api-tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 underline underline-offset-4"
            >
              {t('admin.settings.tunnel.createToken')}
              <ExternalLink aria-hidden="true" className="size-4" />
              <span className="sr-only">{t('admin.settings.tunnel.newTab')}</span>
            </a>
          </div>
          {tunnel.configured ? (
            <p className="text-muted-foreground text-sm">
              {t('admin.settings.tunnel.reconfigureWarning')}
            </p>
          ) : null}
          <Button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>
            {mutation.isPending
              ? t('common.actions.working')
              : tunnel.configured
                ? t('admin.settings.tunnel.reconfigure')
                : t('admin.settings.tunnel.configure')}
          </Button>
        </fieldset>
      </form>
    </div>
  );
}
