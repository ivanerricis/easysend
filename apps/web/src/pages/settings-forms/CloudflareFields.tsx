import type { Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormField, TextField } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';
import type { CloudflareFormValues } from './cloudflare';

interface CloudflareFieldsProps {
  control: Control<CloudflareFormValues>;
  idPrefix?: string;
}

/** Labels of the fields, for `FormErrorSummary`. */
export function cloudflareFieldLabels(t: (key: string) => string) {
  return {
    domain: t('setup.cloudflare.domain'),
    subdomain: t('setup.cloudflare.subdomain'),
    apiToken: t('setup.cloudflare.apiToken'),
  };
}

/** Domain, subdomain and API token fields, identical in the wizard and in the admin settings. */
export function CloudflareFields({ control, idPrefix }: CloudflareFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <TextField
        control={control}
        name="domain"
        idPrefix={idPrefix}
        label={t('setup.cloudflare.domain')}
        description={t('setup.cloudflare.domainHint')}
        placeholder="example.com"
        autoComplete="off"
      />
      <TextField
        control={control}
        name="subdomain"
        idPrefix={idPrefix}
        label={t('setup.cloudflare.subdomain')}
        description={t('setup.cloudflare.subdomainHint')}
        placeholder="files"
        optional
        autoComplete="off"
      />
      <FormField
        control={control}
        name="apiToken"
        idPrefix={idPrefix}
        label={t('setup.cloudflare.apiToken')}
        description={t('setup.cloudflare.apiTokenHint')}
      >
        {({ field, controlProps }) => (
          <PasswordInput autoComplete="off" spellCheck={false} {...field} {...controlProps} />
        )}
      </FormField>
    </>
  );
}
