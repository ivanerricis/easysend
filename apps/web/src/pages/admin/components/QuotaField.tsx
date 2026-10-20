import { Controller, type Control, type FieldValues } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/ui/input';
import { NativeSelect } from './NativeSelect';
import { QUOTA_UNITS, type QuotaUnit } from '../quota';

export interface QuotaFormValues {
  quotaValue: string;
  quotaUnit: QuotaUnit;
}

interface QuotaFieldProps<TValues extends FieldValues & QuotaFormValues> {
  control: Control<TValues>;
  idPrefix?: string;
}

/** Quota as a number plus a MiB/GiB unit; an empty value means "no quota". */
export function QuotaField<TValues extends FieldValues & QuotaFormValues>({
  control,
  idPrefix,
}: QuotaFieldProps<TValues>) {
  const { t } = useTranslation();
  const typed = control as unknown as Control<QuotaFormValues>;
  return (
    <FormField
      control={typed}
      name="quotaValue"
      idPrefix={idPrefix}
      label={t('admin.users.fields.quota')}
      description={t('admin.users.fields.quotaHelp')}
    >
      {({ field, controlProps }) => (
        <div className="flex gap-2">
          <Input
            inputMode="decimal"
            autoComplete="off"
            placeholder={t('admin.users.fields.quotaPlaceholder')}
            className="font-mono"
            {...field}
            {...controlProps}
          />
          <Controller
            control={typed}
            name="quotaUnit"
            render={({ field: unitField }) => (
              <NativeSelect
                className="w-28 shrink-0"
                aria-label={t('admin.users.fields.quotaUnit')}
                {...unitField}
              >
                {QUOTA_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </NativeSelect>
            )}
          />
        </div>
      )}
    </FormField>
  );
}
