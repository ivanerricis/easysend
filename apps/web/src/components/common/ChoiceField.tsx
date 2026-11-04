import { useId } from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export interface ChoiceOption {
  value: string;
  label: string;
  description?: string;
}

interface ChoiceFieldProps<TValues extends FieldValues, TName extends FieldPath<TValues>> {
  control: Control<TValues>;
  name: TName;
  legend: string;
  description?: string;
  options: readonly ChoiceOption[];
}

/** Radio group in a fieldset with a legend, for a short list of exclusive choices. */
export function ChoiceField<TValues extends FieldValues, TName extends FieldPath<TValues>>({
  control,
  name,
  legend,
  description,
  options,
}: ChoiceFieldProps<TValues, TName>) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <fieldset className="space-y-1">
          <legend id={`${id}-legend`} className="text-sm font-medium">
            {legend}
          </legend>
          {description ? (
            <p id={`${id}-description`} className="text-muted-foreground text-sm">
              {description}
            </p>
          ) : null}
          <RadioGroup
            name={field.name}
            value={String(field.value ?? '')}
            onValueChange={field.onChange}
            onBlur={field.onBlur}
            aria-labelledby={`${id}-legend`}
            aria-describedby={description ? `${id}-description` : undefined}
            className="gap-0"
          >
            {options.map((option) => (
              <div key={option.value} className="flex min-h-11 items-start gap-3 py-2.5">
                <RadioGroupItem
                  id={`${id}-${option.value}`}
                  value={option.value}
                  className="mt-0.5"
                />
                <label htmlFor={`${id}-${option.value}`} className="flex-1 cursor-pointer text-sm">
                  <span className="block font-medium">{option.label}</span>
                  {option.description ? (
                    <span className="text-muted-foreground block">{option.description}</span>
                  ) : null}
                </label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      )}
    />
  );
}
