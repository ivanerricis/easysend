import { LINK_PASSWORD_MIN_LENGTH, type TransferDetail } from '@easysend/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField, TextField } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';
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
import { updateTransfer } from '@/lib/api/transfers';
import { errorMessage } from '@/lib/errors';
import { notifySuccess } from '@/lib/toast';
import { buildUpdate, createEditResolver, editDefaults, type EditFormValues } from './edit';

interface EditTransferDialogProps {
  transfer: TransferDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const selectClass =
  'border-input bg-background h-11 w-full min-w-0 border px-3 text-base md:text-sm dark:bg-input/30';

/** Dialog content is unmounted when closed, so the form starts from the current values each time. */
export function EditTransferDialog({ transfer, open, onOpenChange }: EditTransferDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <EditForm transfer={transfer} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  transfer,
  onOpenChange,
}: Pick<EditTransferDialogProps, 'transfer' | 'onOpenChange'>) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [noChanges, setNoChanges] = useState(false);
  const resolver = useMemo(() => createEditResolver(t, transfer), [t, transfer]);
  const form = useForm<EditFormValues>({
    resolver,
    defaultValues: editDefaults(transfer),
    reValidateMode: 'onChange',
  });

  const mutation = useMutation({
    mutationFn: (body: ReturnType<typeof buildUpdate>) => updateTransfer(transfer.id, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.transfers.detail(transfer.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.transfers.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      notifySuccess(t('transfers.edit.saved'));
      onOpenChange(false);
    },
  });

  const submit = form.handleSubmit((values) => {
    const body = buildUpdate(values, transfer);
    if (Object.keys(body).length === 0) {
      setNoChanges(true);
      return;
    }
    setNoChanges(false);
    mutation.mutate(body);
  });

  const passwordMode = useWatch({ control: form.control, name: 'passwordMode' });
  const pending = mutation.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('transfers.edit.title')}</DialogTitle>
        <DialogDescription>{t('transfers.edit.description')}</DialogDescription>
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
          idPrefix="edit"
        />
        {mutation.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{errorMessage(t, mutation.error)}</AlertDescription>
          </Alert>
        ) : null}
        {noChanges ? (
          <Alert role="status">
            <AlertDescription>{t('transfers.edit.noChanges')}</AlertDescription>
          </Alert>
        ) : null}

        <TextField
          control={form.control}
          name="title"
          label={t('transfers.new.title')}
          idPrefix="edit"
          optional
          maxLength={120}
        />
        <FormField
          control={form.control}
          name="message"
          label={t('transfers.new.message')}
          idPrefix="edit"
          optional
        >
          {({ field, controlProps }) => (
            <Textarea {...field} {...controlProps} rows={3} maxLength={2000} />
          )}
        </FormField>
        <FormField
          control={form.control}
          name="expiresIn"
          label={t('transfers.edit.expiry')}
          description={t('transfers.edit.expiryHint')}
          idPrefix="edit"
        >
          {({ field, controlProps }) => (
            <select {...field} {...controlProps} className={selectClass}>
              <option value="keep">{t('transfers.edit.expiryKeep')}</option>
              <option value="3d">
                {t('transfers.edit.expiryFromNow', { period: t('transfers.expiry.3d') })}
              </option>
              <option value="1w">
                {t('transfers.edit.expiryFromNow', { period: t('transfers.expiry.1w') })}
              </option>
              <option value="1m">
                {t('transfers.edit.expiryFromNow', { period: t('transfers.expiry.1m') })}
              </option>
            </select>
          )}
        </FormField>
        <FormField
          control={form.control}
          name="maxDownloads"
          label={t('transfers.new.maxDownloads')}
          description={t('transfers.edit.maxDownloadsHint')}
          idPrefix="edit"
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

        <Controller
          control={form.control}
          name="passwordMode"
          render={({ field }) => (
            <FieldSet>
              <FieldLegend variant="label" className="text-sm font-medium">
                {t('transfers.new.password')}
              </FieldLegend>
              <RadioGroup value={field.value} onValueChange={field.onChange} className="gap-0">
                {(
                  ['keep', 'set', ...(transfer.hasPassword ? (['remove'] as const) : [])] as const
                ).map((value) => (
                  <div key={value} className="flex min-h-11 items-center gap-3">
                    <RadioGroupItem value={value} id={`edit-password-${value}`} />
                    <FieldLabel htmlFor={`edit-password-${value}`} className="text-sm">
                      {t(
                        `transfers.edit.password_${value}${value === 'set' && transfer.hasPassword ? '_replace' : ''}`,
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
            label={t('transfers.edit.newPassword')}
            description={t('transfers.new.passwordHint', { min: LINK_PASSWORD_MIN_LENGTH })}
            idPrefix="edit"
          >
            {({ field, controlProps }) => (
              <PasswordInput {...field} {...controlProps} autoComplete="new-password" />
            )}
          </FormField>
        ) : null}

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
            {pending ? t('common.actions.saving') : t('common.actions.save')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
