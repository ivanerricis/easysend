import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/ui/input';

const HEX = /^#[0-9a-fA-F]{6}$/;

interface ColorFieldProps<TValues extends FieldValues, TName extends FieldPath<TValues>> {
  control: Control<TValues>;
  name: TName;
  label: string;
  description?: string;
  idPrefix?: string;
}

/**
 * Colour as a native picker plus a hex text input kept in sync (the text input is the labelled
 * field; the picker has its own accessible name).
 */
export function ColorField<TValues extends FieldValues, TName extends FieldPath<TValues>>({
  control,
  name,
  label,
  description,
  idPrefix,
}: ColorFieldProps<TValues, TName>) {
  const { t } = useTranslation();
  return (
    <FormField
      control={control}
      name={name}
      idPrefix={idPrefix}
      label={label}
      description={description}
    >
      {({ field, controlProps }) => {
        const value = typeof field.value === 'string' ? field.value : '';
        return (
          <div className="flex gap-2">
            <input
              type="color"
              id={`${controlProps.id}-picker`}
              aria-label={t('admin.appearance.fields.pickColor', { name: label })}
              value={HEX.test(value) ? value.toLowerCase() : '#000000'}
              onChange={(event) => field.onChange(event.target.value)}
              onBlur={field.onBlur}
              className="border-input bg-background size-11 shrink-0 cursor-pointer border p-1"
            />
            <Input
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              maxLength={7}
              placeholder="#rrggbb"
              {...field}
              {...controlProps}
              onChange={(event) => {
                const text = event.target.value.trim();
                field.onChange(text !== '' && !text.startsWith('#') ? `#${text}` : text);
              }}
            />
          </div>
        );
      }}
    </FormField>
  );
}
