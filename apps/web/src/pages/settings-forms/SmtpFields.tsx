import type { Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ChoiceField } from '@/components/common/ChoiceField';
import { FormField, TextField } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';
import type { SmtpFormValues } from './smtp';

interface SmtpFieldsProps {
  control: Control<SmtpFormValues>;
  /** Prefix for the field ids when the form shares a page with others. */
  idPrefix?: string;
  /** A password is already saved: leaving the field empty keeps it. */
  hasPassword: boolean;
}

/** Labels of the fields, for `FormErrorSummary`. */
export function smtpFieldLabels(t: (key: string) => string) {
  return {
    host: t('setup.smtp.host'),
    port: t('setup.smtp.port'),
    fromEmail: t('setup.smtp.fromEmail'),
  };
}

/** The SMTP fields, identical in the setup wizard and in the admin settings. */
export function SmtpFields({ control, idPrefix, hasPassword }: SmtpFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
        <TextField
          control={control}
          name="host"
          idPrefix={idPrefix}
          label={t('setup.smtp.host')}
          autoComplete="off"
          placeholder="smtp.example.com"
        />
        <TextField
          control={control}
          name="port"
          idPrefix={idPrefix}
          label={t('setup.smtp.port')}
          inputMode="numeric"
          autoComplete="off"
        />
      </div>
      <ChoiceField
        control={control}
        name="security"
        legend={t('setup.smtp.security')}
        options={[
          {
            value: 'none',
            label: t('setup.smtp.securityNone'),
            description: t('setup.smtp.securityNoneHint'),
          },
          {
            value: 'starttls',
            label: t('setup.smtp.securityStarttls'),
            description: t('setup.smtp.securityStarttlsHint'),
          },
          {
            value: 'tls',
            label: t('setup.smtp.securityTls'),
            description: t('setup.smtp.securityTlsHint'),
          },
        ]}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          control={control}
          name="username"
          idPrefix={idPrefix}
          label={t('setup.smtp.username')}
          optional
          autoComplete="off"
        />
        <FormField
          control={control}
          name="password"
          idPrefix={idPrefix}
          label={t('setup.smtp.password')}
          optional
          description={hasPassword ? t('setup.smtp.passwordKept') : undefined}
        >
          {({ field, controlProps }) => (
            <PasswordInput
              autoComplete="new-password"
              placeholder={hasPassword ? '••••••••' : undefined}
              {...field}
              {...controlProps}
            />
          )}
        </FormField>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          control={control}
          name="fromEmail"
          idPrefix={idPrefix}
          label={t('setup.smtp.fromEmail')}
          type="email"
          inputMode="email"
          autoComplete="off"
        />
        <TextField
          control={control}
          name="fromName"
          idPrefix={idPrefix}
          label={t('setup.smtp.fromName')}
          optional
          autoComplete="off"
        />
      </div>
    </>
  );
}
