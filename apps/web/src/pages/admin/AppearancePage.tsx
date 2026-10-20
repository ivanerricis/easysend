import { zodResolver } from '@hookform/resolvers/zod';
import {
  AVAILABLE_FONTS,
  DEFAULT_APPEARANCE,
  FOOTER_MAX_LENGTH,
  INSTANCE_NAME_MAX_LENGTH,
  THEME_PREFERENCES,
  appearanceSchema,
  type Appearance,
} from '@easysend/shared';
import { useMutation } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField, TextField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { LoadingState } from '@/components/common/States';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { resetAppearance, updateAppearance } from '@/lib/api/settings';
import { errorMessage } from '@/lib/errors';
import { notifyError, notifySuccess } from '@/lib/toast';
import { NativeSelect } from './components/NativeSelect';
import { BrandingImages } from './appearance/BrandingImages';
import { ColorField } from './appearance/ColorField';

const hexColor = (error: string) =>
  z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, { error });

// The shared schema with translatable messages for the fields the admin edits.
const formSchema = appearanceSchema.extend({
  instanceName: z
    .string()
    .trim()
    .min(1, { error: 'admin.appearance.errors.instanceName' })
    .max(INSTANCE_NAME_MAX_LENGTH, { error: 'admin.appearance.errors.instanceName' }),
  footer: z.string().max(FOOTER_MAX_LENGTH, { error: 'admin.appearance.errors.footer' }),
  primaryColor: hexColor('admin.appearance.errors.color'),
  accentColor: hexColor('admin.appearance.errors.color'),
});

const formatRem = (value: number, locale: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);

export default function AppearancePage() {
  const { t } = useTranslation();
  const { isLoading, appearance } = useAppearance();
  return (
    <>
      <PageHeader
        title={t('admin.appearanceTitle')}
        description={t('admin.appearance.description')}
      />
      {isLoading ? (
        <LoadingState variant="skeleton" lines={5} />
      ) : (
        <div className="space-y-10">
          <AppearanceForm initial={appearance} />
          <BrandingImages />
        </div>
      )}
    </>
  );
}

function AppearanceForm({ initial }: { initial: Appearance }) {
  const { t, i18n } = useTranslation();
  const { refresh } = useAppearance();
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const form = useForm<Appearance>({
    resolver: zodResolver(formSchema),
    defaultValues: initial,
  });
  const { control, handleSubmit, reset, formState } = form;

  const save = useMutation({
    mutationFn: (body: Appearance) =>
      updateAppearance({ ...body, instanceName: body.instanceName.trim() }),
    onSuccess: async (response) => {
      await refresh();
      reset(response.appearance);
      notifySuccess(t('admin.appearance.savedToast'));
    },
    onError: (error) => setFormError(errorMessage(t, error)),
  });

  const restore = async () => {
    try {
      const response = await resetAppearance();
      await refresh();
      reset(response.appearance);
      setFormError(null);
      notifySuccess(t('admin.appearance.resetToast'));
    } catch (error) {
      notifyError(errorMessage(t, error));
      throw error;
    }
  };

  return (
    <div className="space-y-10">
      <form
        noValidate
        className="max-w-2xl space-y-5"
        onSubmit={(event) =>
          void handleSubmit((body) => {
            setFormError(null);
            save.mutate(body);
          })(event)
        }
      >
        <h2 className="text-lg font-semibold">{t('admin.appearance.fields.title')}</h2>
        <FormErrorSummary
          errors={formState.errors}
          submitCount={formState.submitCount}
          idPrefix="appearance"
        />
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <TextField
          control={control}
          name="instanceName"
          idPrefix="appearance"
          autoComplete="off"
          maxLength={INSTANCE_NAME_MAX_LENGTH}
          label={t('admin.appearance.fields.instanceName')}
          description={t('admin.appearance.fields.instanceNameHelp')}
        />
        <TextField
          control={control}
          name="footer"
          idPrefix="appearance"
          autoComplete="off"
          maxLength={FOOTER_MAX_LENGTH}
          label={t('admin.appearance.fields.footer')}
          description={t('admin.appearance.fields.footerHelp')}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <ColorField
            control={control}
            name="primaryColor"
            idPrefix="appearance"
            label={t('admin.appearance.fields.primaryColor')}
            description={t('admin.appearance.fields.primaryColorHelp')}
          />
          <ColorField
            control={control}
            name="accentColor"
            idPrefix="appearance"
            label={t('admin.appearance.fields.accentColor')}
            description={t('admin.appearance.fields.accentColorHelp')}
          />
        </div>
        <FormField
          control={control}
          name="radius"
          idPrefix="appearance"
          label={t('admin.appearance.fields.radius')}
          description={t('admin.appearance.fields.radiusHelp')}
        >
          {({ field, controlProps }) => (
            <div className="flex items-center gap-3">
              <Slider
                min={0}
                max={2}
                step={0.125}
                name={field.name}
                value={[Number(field.value)]}
                onValueChange={([next]) => field.onChange(next)}
                onBlur={field.onBlur}
                thumbProps={{
                  ref: field.ref,
                  'aria-label': t('admin.appearance.fields.radius'),
                  'aria-valuetext': `${formatRem(Number(field.value), i18n.language)} rem`,
                  ...controlProps,
                }}
              />
              <output
                htmlFor={controlProps.id}
                className="w-20 shrink-0 text-right font-mono text-sm"
              >
                {formatRem(Number(field.value), i18n.language)} rem
              </output>
            </div>
          )}
        </FormField>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            control={control}
            name="font"
            idPrefix="appearance"
            label={t('admin.appearance.fields.font')}
          >
            {({ field, controlProps }) => (
              <NativeSelect {...field} {...controlProps}>
                {AVAILABLE_FONTS.map((font) => (
                  <option key={font} value={font}>
                    {t(`admin.appearance.fonts.${font}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            control={control}
            name="defaultTheme"
            idPrefix="appearance"
            label={t('admin.appearance.fields.defaultTheme')}
            description={t('admin.appearance.fields.defaultThemeHelp')}
          >
            {({ field, controlProps }) => (
              <NativeSelect {...field} {...controlProps}>
                {THEME_PREFERENCES.map((theme) => (
                  <option key={theme} value={theme}>
                    {t(`common.theme.${theme}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
            {save.isPending ? t('common.actions.saving') : t('common.actions.save')}
          </Button>
          <Button type="button" variant="outline" onClick={() => setConfirmReset(true)}>
            <RotateCcw aria-hidden="true" />
            {t('admin.appearance.resetDefaults')}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t('admin.appearance.resetTitle')}
        description={t('admin.appearance.resetDescription', {
          name: DEFAULT_APPEARANCE.instanceName,
        })}
        confirmLabel={t('admin.appearance.resetConfirm')}
        destructive
        onConfirm={restore}
      />
    </div>
  );
}
