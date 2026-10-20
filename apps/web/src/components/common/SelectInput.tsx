import { useRef, useState, type ReactNode } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface SelectOptionItem {
  value: string;
  label: ReactNode;
  /** Language of the label, when it differs from the page language. */
  lang?: string;
}

/** Radix Select forbids an empty-string item value: "none / all" options use this sentinel. */
const EMPTY_VALUE = '__empty__';

interface SelectInputProps {
  options: readonly SelectOptionItem[];
  value: string;
  onValueChange: (value: string) => void;
  /** Shown when `value` matches no option. */
  placeholder?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  contentClassName?: string;
  onBlur?: () => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/**
 * shadcn/ui `Select` (Radix) with the options as data. Works with `FormField` (spread `field` and
 * `controlProps`, using `onValueChange={field.onChange}`) and as a plain controlled filter.
 * An option with value `''` ("all", "none") is supported through a sentinel.
 */
export function SelectInput({
  options,
  value,
  onValueChange,
  placeholder,
  className,
  contentClassName,
  onBlur,
  id,
  name,
  disabled,
  required,
  ...aria
}: SelectInputProps) {
  const hasEmpty = options.some((option) => option.value === '');
  const internal = value === '' && hasEmpty ? EMPTY_VALUE : value;
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The <label for> names the trigger only: the listbox gets the same name when it opens.
  const [listLabel, setListLabel] = useState<string | undefined>(aria['aria-label']);
  return (
    <Select
      value={internal}
      name={name}
      disabled={disabled}
      required={required}
      onValueChange={(next) => onValueChange(next === EMPTY_VALUE ? '' : next)}
      onOpenChange={(open) => {
        if (open) {
          setListLabel(aria['aria-label'] ?? triggerRef.current?.labels?.[0]?.textContent?.trim());
        }
      }}
    >
      <SelectTrigger
        ref={triggerRef}
        id={id}
        onBlur={onBlur}
        className={cn('w-full min-w-0', className)}
        {...aria}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className={contentClassName} aria-label={listLabel}>
        {options.map((option) => (
          <SelectItem
            key={option.value || EMPTY_VALUE}
            value={option.value === '' ? EMPTY_VALUE : option.value}
            lang={option.lang}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
