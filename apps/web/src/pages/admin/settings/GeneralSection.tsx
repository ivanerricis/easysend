import { zodResolver } from '@hookform/resolvers/zod';
import { CHUNK_SIZE_MB, LOCALES, type GeneralSettings } from '@easysend/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { queryKeys } from '@/app/query';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField, TextField } from '@/components/common/FormField';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { updateGeneralSettings } from '@/lib/api/settings';
import { errorMessage } from '@/lib/errors';
import { notifySuccess } from '@/lib/toast';
import { NativeSelect } from '../components/NativeSelect';

const RESERVE_MAX_MB = 10_485_760;

const wholeNumber = (min: number, max: number, error: string) =>
  z
    .string()
    .trim()
    .refine((value) => /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max, {
      error,
    });

const formSchema = z.object({
  diskReserveMb: wholeNumber(0, RESERVE_MAX_MB, 'admin.settings.general.errors.reserve'),
  chunkSizeMb: wholeNumber(1, CHUNK_SIZE_MB.max, 'admin.settings.general.errors.chunk'),
  defaultLocale: z.enum(LOCALES),
});
type FormValues = z.infer<typeof formSchema>;

function toFormValues(settings: GeneralSettings): FormValues {
  return {
    diskReserveMb: String(settings.diskReserveMb),
    chunkSizeMb: String(settings.chunkSizeMb),
    defaultLocale: settings.defaultLocale,
  };
}

export function GeneralSection({ settings }: { settings: GeneralSettings }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { refresh } = useAppearance();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(settings),
  });
  const { control, handleSubmit, reset, formState } = form;

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      updateGeneralSettings({
        diskReserveMb: Number(values.diskReserveMb),
        chunkSizeMb: Number(values.chunkSizeMb),
        defaultLocale: values.defaultLocale,
      }),
    onSuccess: async (response) => {
      queryClient.setQueryData(queryKeys.admin.settings, response);
      reset(toFormValues(response.general));
      await refresh();
      notifySuccess(t('admin.settings.savedToast'));
    },
    onError: (error) => setFormError(errorMessage(t, error)),
  });

  return (
    <form
      noValidate
      className="max-w-xl space-y-4"
      onSubmit={(event) =>
        void handleSubmit((values) => {
          setFormError(null);
          mutation.mutate(values);
        })(event)
      }
    >
      <FormErrorSummary
        errors={formState.errors}
        submitCount={formState.submitCount}
        idPrefix="general"
      />
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      <TextField
        control={control}
        name="diskReserveMb"
        idPrefix="general"
        inputMode="numeric"
        autoComplete="off"
        label={t('admin.settings.general.diskReserve')}
        description={t('admin.settings.general.diskReserveHelp')}
      />
      <TextField
        control={control}
        name="chunkSizeMb"
        idPrefix="general"
        inputMode="numeric"
        autoComplete="off"
        label={t('admin.settings.general.chunkSize')}
        description={t('admin.settings.general.chunkSizeHelp', { max: CHUNK_SIZE_MB.max })}
      />
      <FormField
        control={control}
        name="defaultLocale"
        idPrefix="general"
        label={t('admin.settings.general.defaultLocale')}
        description={t('admin.settings.general.defaultLocaleHelp')}
      >
        {({ field, controlProps }) => (
          <NativeSelect {...field} {...controlProps}>
            {LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {t(`admin.locales.${locale}`)}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <Button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>
        {mutation.isPending ? t('common.actions.saving') : t('common.actions.save')}
      </Button>
    </form>
  );
}
