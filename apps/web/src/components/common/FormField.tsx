import type { ReactNode } from 'react';
import {
  Controller,
  type Control,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Deterministic DOM id of a form control, shared by `FormField` and `FormErrorSummary` so the
 * summary can link to it. Use a different `prefix` when two forms share a page.
 */
export function fieldId(name: string, prefix = 'field'): string {
  return `${prefix}-${name.replace(/\./g, '-')}`;
}

/** Attributes to spread on the control so label, description and error are wired up. */
export interface ControlProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

interface FormFieldProps<TValues extends FieldValues, TName extends FieldPath<TValues>> {
  control: Control<TValues>;
  name: TName;
  label: ReactNode;
  description?: ReactNode;
  /** Appends the localized "(optional)" hint to the label. */
  optional?: boolean;
  /** Prefix for the control id, see `fieldId`. */
  idPrefix?: string;
  className?: string;
  /** Renders the control. Spread `controlProps` on it and wire `field` (value, onChange...). */
  children: (args: {
    field: ControllerRenderProps<TValues, TName>;
    controlProps: ControlProps;
  }) => ReactNode;
}

/**
 * react-hook-form field with a visible label, optional description and an inline error
 * (`role="alert"`). Error messages from Zod may be i18n keys (e.g. `auth.errors.emailInvalid`):
 * they are translated, and anything that is not a known key is shown as is.
 *
 * @example
 * <FormField control={control} name="email" label={t('auth.email')}>
 *   {({ field, controlProps }) => <Input type="email" {...field} {...controlProps} />}
 * </FormField>
 */
export function FormField<TValues extends FieldValues, TName extends FieldPath<TValues>>({
  control,
  name,
  label,
  description,
  optional,
  idPrefix,
  className,
  children,
}: FormFieldProps<TValues, TName>) {
  const { t } = useTranslation();
  const id = fieldId(name, idPrefix);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const message = fieldState.error?.message;
        const descriptionId = description ? `${id}-description` : undefined;
        const errorId = message ? `${id}-error` : undefined;
        const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
        return (
          <Field data-invalid={fieldState.invalid || undefined} className={className}>
            <FieldLabel htmlFor={id} className="text-sm font-medium">
              {label}
              {optional ? (
                <span className="text-muted-foreground font-normal">
                  ({t('common.form.optional')})
                </span>
              ) : null}
            </FieldLabel>
            {children({
              field,
              controlProps: {
                id,
                'aria-invalid': fieldState.invalid,
                'aria-describedby': describedBy,
              },
            })}
            {description ? (
              <FieldDescription id={descriptionId}>{description}</FieldDescription>
            ) : null}
            {message ? (
              <FieldError id={errorId}>{t(message, { defaultValue: message })}</FieldError>
            ) : null}
          </Field>
        );
      }}
    />
  );
}

interface TextFieldProps<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
> extends Omit<FormFieldProps<TValues, TName>, 'children'> {
  type?: 'text' | 'email' | 'number' | 'search' | 'tel' | 'url';
  autoComplete?: string;
  placeholder?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'search' | 'tel' | 'url';
  autoFocus?: boolean;
  disabled?: boolean;
  maxLength?: number;
}

/** `FormField` + `Input` for the common single-line text case. */
export function TextField<TValues extends FieldValues, TName extends FieldPath<TValues>>({
  type = 'text',
  autoComplete,
  placeholder,
  inputMode,
  autoFocus,
  disabled,
  maxLength,
  ...fieldProps
}: TextFieldProps<TValues, TName>) {
  return (
    <FormField {...fieldProps}>
      {({ field, controlProps }) => (
        <Input
          type={type}
          autoComplete={autoComplete}
          placeholder={placeholder}
          inputMode={inputMode}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- opt-in prop for the first field of a new step
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={maxLength}
          {...field}
          value={field.value ?? ''}
          {...controlProps}
        />
      )}
    </FormField>
  );
}

interface CheckboxFieldProps<TValues extends FieldValues, TName extends FieldPath<TValues>> {
  control: Control<TValues>;
  name: TName;
  label: ReactNode;
  description?: ReactNode;
  idPrefix?: string;
  className?: string;
  disabled?: boolean;
}

/** Checkbox in a row at least 44px tall; the whole row (label included) toggles it. */
export function CheckboxField<TValues extends FieldValues, TName extends FieldPath<TValues>>({
  control,
  name,
  label,
  description,
  idPrefix,
  className,
  disabled,
}: CheckboxFieldProps<TValues, TName>) {
  const { t } = useTranslation();
  const id = fieldId(name, idPrefix);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const message = fieldState.error?.message;
        const descriptionId = description ? `${id}-description` : undefined;
        const errorId = message ? `${id}-error` : undefined;
        const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
        return (
          <Field data-invalid={fieldState.invalid || undefined} className={className}>
            <div className="flex min-h-11 items-start gap-3">
              <Checkbox
                id={id}
                className="mt-3"
                checked={field.value === true}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
                ref={field.ref}
                name={field.name}
                disabled={disabled}
                aria-invalid={fieldState.invalid}
                aria-describedby={describedBy}
              />
              <FieldLabel htmlFor={id} className={cn('min-h-11 flex-1 py-3 text-sm font-medium')}>
                {label}
              </FieldLabel>
            </div>
            {description ? (
              <FieldDescription id={descriptionId}>{description}</FieldDescription>
            ) : null}
            {message ? (
              <FieldError id={errorId}>{t(message, { defaultValue: message })}</FieldError>
            ) : null}
          </Field>
        );
      }}
    />
  );
}
