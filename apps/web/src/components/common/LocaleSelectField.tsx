import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { LOCALES } from '@easysend/shared';
import { useTranslation } from 'react-i18next';
import { SelectField } from '@/components/common/FormField';

interface LocaleSelectFieldProps<TValues extends FieldValues, TName extends FieldPath<TValues>> {
  control: Control<TValues>;
  name: TName;
  label: string;
  description?: string;
  idPrefix?: string;
}

/** `SelectField` with the supported UI locales (translated names under `admin.locales`). */
export function LocaleSelectField<TValues extends FieldValues, TName extends FieldPath<TValues>>(
  props: LocaleSelectFieldProps<TValues, TName>,
) {
  const { t } = useTranslation();
  const options = LOCALES.map((locale) => ({ value: locale, label: t(`admin.locales.${locale}`) }));
  return <SelectField {...props} options={options} />;
}
