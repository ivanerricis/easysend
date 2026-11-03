import { EXPIRY_KEYS, LINK_PASSWORD_MIN_LENGTH, type UploadRequestDetail } from '@easysend/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField, SelectField, SwitchField, TextField } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';
import { SelectInput } from '@/components/common/SelectInput';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { createUploadRequest, updateUploadRequest } from '@/lib/api/requests';
import { errorMessage } from '@/lib/errors';
import { notifySuccess } from '@/lib/toast';
import { QUOTA_UNITS } from '../admin/quota';
import {
  CREATE_DEFAULTS,
  buildCreate,
  buildUpdate,
  createRequestResolver,
  editDefaults,
  type RequestFormValues,
} from './form';

interface RequestFormDialogProps {
  /** The request to edit; omitted to create a new one. */
  request?: UploadRequestDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the created request (the page shows its link). */
  onCreated?: (request: UploadRequestDetail) => void;
  /** Where the focus goes when the dialog closes (see `restoreRowFocus`). */
  onCloseAutoFocus?: (event: Event) => void;
}

/** Dialog content is unmounted when closed, so the form starts from the current values each time. */
export function RequestFormDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  ...rest
}: RequestFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <RequestForm onOpenChange={onOpenChange} {...rest} />
      </DialogContent>
    </Dialog>
  );
}

const PREFIX = 'request';

function RequestForm({
  request,
  onOpenChange,
  onCreated,
}: Pick<RequestFormDialogProps, 'request' | 'onOpenChange' | 'onCreated'>) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [noChanges, setNoChanges] = useState(false);
  const isEdit = request !== undefined;
  const resolver = useMemo(() => createRequestResolver(t, request), [t, request]);
  const form = useForm<RequestFormValues>({
    resolver,
    defaultValues: request ? editDefaults(request) : CREATE_DEFAULTS,
    reValidateMode: 'onChange',
  });

  const mutation = useMutation({
    mutationFn: (values: RequestFormValues) =>
      request
        ? updateUploadRequest(request.id, buildUpdate(values, request))
        : createUploadRequest(buildCreate(values)),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.requests.detail(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.requests.all });
      if (isEdit) notifySuccess(t('requests.saved'));
      else onCreated?.(saved);
      onOpenChange(false);
    },
  });

  const submit = form.handleSubmit((values) => {
    if (request && Object.keys(buildUpdate(values, request)).length === 0) {
      setNoChanges(true);
      return;
    }
    setNoChanges(false);
    mutation.mutate(values);
  });

  const passwordMode = useWatch({ control: form.control, name: 'passwordMode' });
  const pending = mutation.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(isEdit ? 'requests.form.editTitle' : 'requests.form.createTitle')}
        </DialogTitle>
        <DialogDescription>
          {t(isEdit ? 'requests.form.editDescription' : 'requests.form.createDescription')}
        </DialogDescription>
      </DialogHeader>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event);
        }}
        className="space-y-5"
      >
        <FormErrorSummary
          errors={form.formState.errors}
          submitCount={form.formState.submitCount}
          idPrefix={PREFIX}
        />
        {mutation.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{errorMessage(t, mutation.error)}</AlertDescription>
          </Alert>
        ) : null}
        {noChanges ? (
          <Alert role="status">
            <AlertDescription>{t('requests.form.noChanges')}</AlertDescription>
          </Alert>
        ) : null}

        <TextField
          control={form.control}
          name="title"
          label={t('requests.form.title')}
          idPrefix={PREFIX}
          maxLength={120}
          autoComplete="off"
        />
        <FormField
          control={form.control}
          name="message"
          label={t('requests.form.message')}
          description={t('requests.form.messageHint')}
          idPrefix={PREFIX}
          optional
        >
          {({ field, controlProps }) => (
            <Textarea {...field} {...controlProps} rows={3} maxLength={2000} />
          )}
        </FormField>
        <SelectField
          control={form.control}
          name="expiresIn"
          label={t('requests.form.expiry')}
          description={isEdit ? t('requests.form.expiryHint') : undefined}
          idPrefix={PREFIX}
          options={[
            ...(isEdit ? [{ value: 'keep', label: t('requests.form.expiryKeep') }] : []),
            ...EXPIRY_KEYS.map((period) => ({
              value: period,
              label: isEdit
                ? t('requests.form.expiryFromNow', { period: t(`transfers.expiry.${period}`) })
                : t(`transfers.expiry.${period}`),
            })),
          ]}
        />

        {request ? (
          <>
            <Controller
              control={form.control}
              name="passwordMode"
              render={({ field }) => (
                <FieldSet>
                  <FieldLegend variant="label" className="text-sm font-medium">
                    {t('requests.form.password')}
                  </FieldLegend>
                  <RadioGroup
                    name={field.name}
                    value={field.value}
                    onValueChange={field.onChange}
                    className="gap-0"
                  >
                    {(
                      [
                        'keep',
                        'set',
                        ...(request.hasPassword ? (['remove'] as const) : []),
                      ] as const
                    ).map((value) => (
                      <div key={value} className="flex min-h-11 items-center gap-3">
                        <RadioGroupItem value={value} id={`${PREFIX}-password-${value}`} />
                        <FieldLabel htmlFor={`${PREFIX}-password-${value}`} className="text-sm">
                          {t(
                            `requests.form.password_${value}${value === 'set' && request.hasPassword ? '_replace' : ''}`,
                          )}
                        </FieldLabel>
                      </div>
                    ))}
                  </RadioGroup>
                </FieldSet>
              )}
            />
            {passwordMode === 'set' ? (
              <FormField
                control={form.control}
                name="password"
                label={t('requests.form.newPassword')}
                description={t('requests.form.passwordHint', { min: LINK_PASSWORD_MIN_LENGTH })}
                idPrefix={PREFIX}
              >
                {({ field, controlProps }) => (
                  <PasswordInput {...field} {...controlProps} autoComplete="new-password" />
                )}
              </FormField>
            ) : null}
          </>
        ) : (
          <FormField
            control={form.control}
            name="password"
            label={t('requests.form.password')}
            description={t('requests.form.passwordHint', { min: LINK_PASSWORD_MIN_LENGTH })}
            idPrefix={PREFIX}
            optional
          >
            {({ field, controlProps }) => (
              <PasswordInput {...field} {...controlProps} autoComplete="new-password" />
            )}
          </FormField>
        )}

        <FormField
          control={form.control}
          name="sizeValue"
          label={t('requests.form.maxSize')}
          description={t('requests.form.maxSizeHint')}
          idPrefix={PREFIX}
          optional
        >
          {({ field, controlProps }) => (
            <div className="flex gap-2">
              <Input
                {...field}
                {...controlProps}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className="min-w-0 flex-1 font-mono"
              />
              <Controller
                control={form.control}
                name="sizeUnit"
                render={({ field: unit }) => (
                  <SelectInput
                    aria-label={t('requests.form.sizeUnit')}
                    className="w-28"
                    value={unit.value}
                    onValueChange={unit.onChange}
                    options={QUOTA_UNITS.map((value) => ({ value, label: value }))}
                  />
                )}
              />
            </div>
          )}
        </FormField>
        <FormField
          control={form.control}
          name="maxSubmissions"
          label={t('requests.form.maxSubmissions')}
          description={t('requests.form.maxSubmissionsHint')}
          idPrefix={PREFIX}
          optional
        >
          {({ field, controlProps }) => (
            <Input
              {...field}
              {...controlProps}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="max-w-40 font-mono"
            />
          )}
        </FormField>

        <div>
          <SwitchField
            control={form.control}
            name="requireName"
            label={t('requests.form.requireName')}
            idPrefix={PREFIX}
          />
          <SwitchField
            control={form.control}
            name="requireEmail"
            label={t('requests.form.requireEmail')}
            idPrefix={PREFIX}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t('common.actions.cancel')}
          </Button>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending
              ? t('common.actions.saving')
              : t(isEdit ? 'common.actions.save' : 'common.actions.create')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
