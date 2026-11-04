import type { ReactNode } from 'react';
import type { Control, FieldValues } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';

interface NewPasswordFieldsProps<TValues extends FieldValues> {
  control: Control<TValues>;
  /** Name of the new-password field; the confirmation field is always `confirmPassword`. */
  passwordName?: string;
  idPrefix?: string;
  label?: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
}

interface PasswordValues extends FieldValues {
  confirmPassword: string;
}

/** New password plus its confirmation; pair it with `withPasswordConfirmation`. */
export function NewPasswordFields<TValues extends FieldValues>({
  control,
  passwordName = 'newPassword',
  idPrefix,
  label,
  description,
  confirmLabel,
}: NewPasswordFieldsProps<TValues>) {
  const { t } = useTranslation();
  const typed = control as unknown as Control<PasswordValues>;
  return (
    <>
      <FormField
        control={typed}
        name={passwordName as 'confirmPassword'}
        idPrefix={idPrefix}
        label={label ?? t('auth.newPassword')}
        description={description}
      >
        {({ field, controlProps }) => (
          <PasswordInput autoComplete="new-password" {...field} {...controlProps} />
        )}
      </FormField>
      <FormField
        control={typed}
        name="confirmPassword"
        idPrefix={idPrefix}
        label={confirmLabel ?? t('auth.confirmPassword')}
      >
        {({ field, controlProps }) => (
          <PasswordInput autoComplete="new-password" {...field} {...controlProps} />
        )}
      </FormField>
    </>
  );
}
