import { LINK_PASSWORD_MIN_LENGTH, type ConfigResponse } from '@easysend/shared';
import { X } from 'lucide-react';
import { Controller, useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormField, TextField, fieldId } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';
import { Button } from '@/components/ui/button';
import {
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { addAddresses, type TransferFormValues } from './form';

interface OptionsFieldsProps {
  form: UseFormReturn<TransferFormValues>;
  config: ConfigResponse;
  disabled?: boolean;
}

const EXPIRY_LABEL = {
  '3d': 'transfers.expiry.3d',
  '1w': 'transfers.expiry.1w',
  '1m': 'transfers.expiry.1m',
} as const;

/** Adds the text typed in the recipients input to the list; returns false when it is invalid. */
export function commitRecipientInput(
  form: UseFormReturn<TransferFormValues>,
  t: ReturnType<typeof useTranslation>['t'],
): boolean {
  const text = form.getValues('recipientInput');
  if (!text.trim()) return true;
  const result = addAddresses(form.getValues('recipients'), text, t);
  if (result.error) {
    form.setError('recipients', { type: 'validation', message: result.error });
    return false;
  }
  form.setValue('recipients', result.recipients, { shouldDirty: true });
  form.setValue('recipientInput', '');
  form.clearErrors('recipients');
  return true;
}

function Recipients({
  form,
  disabled,
}: {
  form: UseFormReturn<TransferFormValues>;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const id = fieldId('recipients');
  const recipients = useWatch({ control: form.control, name: 'recipients' });
  const error = form.formState.errors.recipients?.message;
  const describedBy = [`${id}-description`, error ? `${id}-error` : undefined]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="space-y-2">
      <FieldLabel htmlFor={id} className="text-sm font-medium">
        {t('transfers.new.recipients')}
      </FieldLabel>
      <div className="flex gap-2">
        <Controller
          control={form.control}
          name="recipientInput"
          render={({ field }) => (
            <Input
              {...field}
              id={id}
              type="text"
              inputMode="email"
              autoComplete="off"
              disabled={disabled}
              placeholder={t('transfers.new.recipientsPlaceholder')}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              onPaste={(event) => {
                // A pasted list (commas, spaces or one address per line) becomes several chips.
                const text = event.clipboardData.getData('text');
                if (!/[\s,;]/.test(text.trim())) return;
                event.preventDefault();
                const current = form.getValues('recipientInput');
                form.setValue('recipientInput', `${current} ${text}`.trim());
                commitRecipientInput(form, t);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  commitRecipientInput(form, t);
                }
              }}
            />
          )}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => commitRecipientInput(form, t)}
        >
          {t('common.actions.add')}
        </Button>
      </div>
      <FieldDescription id={`${id}-description`}>
        {t('transfers.new.recipientsHint')}
      </FieldDescription>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      {recipients.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('transfers.new.recipientsList')}>
          {recipients.map((email) => (
            <li
              key={email}
              className="border-border bg-muted flex items-center gap-1 border py-0.5 pl-2 text-sm"
            >
              <span className="break-all">{email}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                aria-label={t('transfers.new.removeRecipient', { email })}
                onClick={() =>
                  form.setValue(
                    'recipients',
                    recipients.filter((r) => r !== email),
                    { shouldDirty: true },
                  )
                }
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Mode, recipients, expiry, title, message, password and download limit. */
export function OptionsFields({ form, config, disabled }: OptionsFieldsProps) {
  const { t } = useTranslation();
  const { control } = form;
  const mode = useWatch({ control, name: 'mode' });
  const { limits } = config;
  return (
    <div className="space-y-5">
      <Controller
        control={control}
        name="mode"
        render={({ field }) => (
          <FieldSet>
            <FieldLegend variant="label" className="text-sm font-medium">
              {t('transfers.new.mode')}
            </FieldLegend>
            <RadioGroup
              value={field.value}
              onValueChange={(value) => {
                field.onChange(value);
                form.clearErrors('recipients');
              }}
              disabled={disabled}
              className="gap-0"
            >
              {(['link', 'email'] as const).map((value) => (
                <div key={value} className="flex min-h-11 items-start gap-3 py-2.5">
                  <RadioGroupItem value={value} id={`mode-${value}`} className="mt-0.5" />
                  <div className="space-y-0.5">
                    <FieldLabel htmlFor={`mode-${value}`} className="text-sm font-medium">
                      {t(`transfers.new.mode_${value}`)}
                    </FieldLabel>
                    <FieldDescription>{t(`transfers.new.mode_${value}_hint`)}</FieldDescription>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </FieldSet>
        )}
      />

      {mode === 'email' ? <Recipients form={form} disabled={disabled} /> : null}

      <Controller
        control={control}
        name="expiresIn"
        render={({ field }) => (
          <FieldSet>
            <FieldLegend variant="label" className="text-sm font-medium">
              {t('transfers.new.expiry')}
            </FieldLegend>
            <RadioGroup
              value={field.value}
              onValueChange={field.onChange}
              disabled={disabled}
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            >
              {config.expiryOptions.map((option) => (
                <label
                  key={option.key}
                  htmlFor={`expiry-${option.key}`}
                  className="border-border has-data-checked:border-primary flex min-h-11 cursor-pointer items-center gap-3 border px-3 text-sm"
                >
                  <RadioGroupItem value={option.key} id={`expiry-${option.key}`} />
                  {t(EXPIRY_LABEL[option.key])}
                </label>
              ))}
            </RadioGroup>
          </FieldSet>
        )}
      />

      <TextField
        control={control}
        name="title"
        label={t('transfers.new.title')}
        optional
        maxLength={limits.maxTitleLength}
        disabled={disabled}
        autoComplete="off"
      />

      <FormField
        control={control}
        name="message"
        label={t('transfers.new.message')}
        description={t(
          mode === 'email' ? 'transfers.new.messageHintEmail' : 'transfers.new.messageHintLink',
        )}
        optional
      >
        {({ field, controlProps }) => (
          <Textarea
            {...field}
            {...controlProps}
            rows={3}
            maxLength={limits.maxMessageLength}
            disabled={disabled}
          />
        )}
      </FormField>

      <FormField
        control={control}
        name="password"
        label={t('transfers.new.password')}
        description={t('transfers.new.passwordHint', { min: LINK_PASSWORD_MIN_LENGTH })}
        optional
      >
        {({ field, controlProps }) => (
          <PasswordInput
            {...field}
            {...controlProps}
            autoComplete="new-password"
            disabled={disabled}
          />
        )}
      </FormField>

      <FormField
        control={control}
        name="maxDownloads"
        label={t('transfers.new.maxDownloads')}
        description={t('transfers.new.maxDownloadsHint')}
        optional
      >
        {({ field, controlProps }) => (
          <Input
            {...field}
            {...controlProps}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
            className="max-w-40 font-mono"
          />
        )}
      </FormField>
    </div>
  );
}
