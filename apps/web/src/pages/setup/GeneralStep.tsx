import {
  CHUNK_SIZE_MB,
  DEFAULT_APPEARANCE,
  INSTANCE_NAME_MAX_LENGTH,
  LOCALES,
  THEME_PREFERENCES,
  setupGeneralRequestSchema,
} from '@easysend/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { TextField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { saveSetupGeneral } from '@/lib/api/setup';
import { useZodForm } from '../auth/form-errors';
import { apiErrorText } from '../auth/helpers';
import { Notice } from '../auth/Notice';
import { ChoiceField } from './ChoiceField';
import { StepHeading } from './StepHeading';
import { stepActionsClass, type StepProps } from './types';

/** Default free-disk reserve, in MB (1 GB). */
export const DEFAULT_DISK_RESERVE_MB = 1024;

const toNumber = (raw: string) => (raw.trim() === '' ? Number.NaN : Number(raw.trim()));

const formSchema = z
  .object({
    instanceName: z.string(),
    diskReserveMb: z.string(),
    chunkSizeMb: z.string(),
    defaultLocale: z.enum(LOCALES),
    defaultTheme: z.enum(THEME_PREFERENCES),
  })
  .transform((v) => ({
    instanceName: v.instanceName.trim(),
    diskReserveMb: toNumber(v.diskReserveMb),
    chunkSizeMb: toNumber(v.chunkSizeMb),
    defaultLocale: v.defaultLocale,
    defaultTheme: v.defaultTheme,
  }))
  .pipe(setupGeneralRequestSchema);

export function GeneralStep({ onFatal, onDone }: StepProps) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useZodForm(formSchema, {
    defaultValues: {
      instanceName: DEFAULT_APPEARANCE.instanceName,
      diskReserveMb: String(DEFAULT_DISK_RESERVE_MB),
      chunkSizeMb: String(CHUNK_SIZE_MB.default),
      defaultLocale: i18n.language.startsWith('it') ? 'it' : 'en',
      defaultTheme: DEFAULT_APPEARANCE.defaultTheme,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await saveSetupGeneral(values);
      onDone({ instanceName: values.instanceName });
    } catch (e) {
      if (onFatal(e)) return;
      setError(apiErrorText(t, e));
    }
  });

  return (
    <div>
      <StepHeading description={t('setup.general.intro')}>{t('setup.general.title')}</StepHeading>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-5">
        <FormErrorSummary
          errors={formState.errors}
          submitCount={formState.submitCount}
          labels={{
            instanceName: t('setup.general.instanceName'),
            diskReserveMb: t('setup.general.diskReserve'),
            chunkSizeMb: t('setup.general.chunkSize'),
          }}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <TextField
          control={control}
          name="instanceName"
          label={t('setup.general.instanceName')}
          description={t('setup.general.instanceNameHint')}
          maxLength={INSTANCE_NAME_MAX_LENGTH}
          autoComplete="off"
        />
        <TextField
          control={control}
          name="diskReserveMb"
          label={t('setup.general.diskReserve')}
          description={t('setup.general.diskReserveHint')}
          inputMode="numeric"
          autoComplete="off"
        />
        <TextField
          control={control}
          name="chunkSizeMb"
          label={t('setup.general.chunkSize')}
          description={t('setup.general.chunkSizeHint', {
            max: CHUNK_SIZE_MB.max,
            default: CHUNK_SIZE_MB.default,
          })}
          inputMode="numeric"
          autoComplete="off"
        />
        <ChoiceField
          control={control}
          name="defaultLocale"
          legend={t('setup.general.language')}
          description={t('setup.general.languageHint')}
          options={[
            { value: 'it', label: 'Italiano' },
            { value: 'en', label: 'English' },
          ]}
        />
        <ChoiceField
          control={control}
          name="defaultTheme"
          legend={t('setup.general.theme')}
          description={t('setup.general.themeHint')}
          options={[
            { value: 'system', label: t('common.theme.system') },
            { value: 'light', label: t('common.theme.light') },
            { value: 'dark', label: t('common.theme.dark') },
          ]}
        />
        <div className={stepActionsClass}>
          <Button type="submit" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? t('common.actions.saving') : t('common.actions.continue')}
          </Button>
        </div>
      </form>
    </div>
  );
}
