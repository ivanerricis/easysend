import { zodResolver } from '@hookform/resolvers/zod';
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  LOCALES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USER_ROLES,
  type AdminUser,
  type UpdateUserRequest,
} from '@easysend/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { queryKeys } from '@/app/query';
import { CheckboxField, FormField, TextField } from '@/components/common/FormField';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { PasswordInput } from '@/components/common/PasswordInput';
import { LoadingState } from '@/components/common/States';
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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { createUser, deleteUser, listUsers, updateUser } from '@/lib/api/admin';
import { isApiError } from '@/lib/api/client';
import { errorMessage, hasErrorCode } from '@/lib/errors';
import { notifySuccess } from '@/lib/toast';
import { SelectInput } from '@/components/common/SelectInput';
import { QuotaField } from '../components/QuotaField';
import { QUOTA_UNITS, bytesToQuotaFields, quotaToBytes } from '../quota';

const DIALOG_CLASS = 'max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg';

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.storage }),
    ]);
}

const quotaShape = {
  quotaValue: z.string(),
  quotaUnit: z.enum(QUOTA_UNITS),
};

function checkQuota(value: { quotaValue: string; quotaUnit: (typeof QUOTA_UNITS)[number] }) {
  return quotaToBytes(value.quotaValue, value.quotaUnit) !== undefined;
}

const displayNameField = z.string().trim().max(DISPLAY_NAME_MAX_LENGTH, {
  error: 'admin.users.errors.displayNameTooLong',
});

// ---- Create ----------------------------------------------------------------------------------
const createFormSchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(1, { error: 'admin.users.errors.emailRequired' })
      .max(EMAIL_MAX_LENGTH, { error: 'admin.users.errors.emailInvalid' })
      .refine((value) => z.email().safeParse(value).success, {
        error: 'admin.users.errors.emailInvalid',
      }),
    displayName: displayNameField,
    role: z.enum(USER_ROLES),
    locale: z.enum(LOCALES),
    password: z
      .string()
      .max(PASSWORD_MAX_LENGTH, { error: 'admin.users.errors.passwordTooLong' })
      .refine((value) => value === '' || value.length >= PASSWORD_MIN_LENGTH, {
        error: 'admin.users.errors.passwordTooShort',
      }),
    ...quotaShape,
  })
  .refine(checkQuota, { path: ['quotaValue'], error: 'admin.users.errors.quotaInvalid' });
type CreateFormValues = z.infer<typeof createFormSchema>;

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateUserDialog({ open, onOpenChange }: DialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>{t('admin.users.create.title')}</DialogTitle>
          <DialogDescription>{t('admin.users.create.description')}</DialogDescription>
        </DialogHeader>
        <CreateUserForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { defaultLocale } = useAppearance();
  const invalidate = useInvalidateUsers();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CreateFormValues>({
    resolver: zodResolver(createFormSchema),
    defaultValues: {
      email: '',
      displayName: '',
      role: 'user',
      locale: defaultLocale,
      password: '',
      quotaValue: '',
      quotaUnit: 'GiB',
    },
  });
  const { control, handleSubmit, setError, formState } = form;
  const passwordEmpty = useWatch({ control, name: 'password' }) === '';

  const mutation = useMutation({
    mutationFn: (values: CreateFormValues) => {
      const displayName = values.displayName.trim();
      return createUser({
        email: values.email.trim(),
        ...(displayName ? { displayName } : {}),
        role: values.role,
        locale: values.locale,
        ...(values.password ? { password: values.password } : {}),
        quotaBytes: quotaToBytes(values.quotaValue, values.quotaUnit) ?? null,
      });
    },
    onSuccess: async (_user, values) => {
      await invalidate();
      notifySuccess(
        values.password
          ? t('admin.users.create.createdToast')
          : t('admin.users.create.createdWelcomeToast', { email: values.email.trim() }),
      );
      onDone();
    },
    onError: (error) => {
      if (hasErrorCode(error, 'EMAIL_ALREADY_EXISTS')) {
        setFormError(null);
        setError('email', { type: 'server', message: t('errors.EMAIL_ALREADY_EXISTS') });
        document.getElementById('create-user-email')?.focus();
        return;
      }
      setFormError(errorMessage(t, error));
    },
  });

  return (
    <form
      noValidate
      className="space-y-4"
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
        idPrefix="create-user"
      />
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      <TextField
        control={control}
        name="email"
        idPrefix="create-user"
        type="email"
        autoComplete="off"
        label={t('admin.users.fields.email')}
      />
      <TextField
        control={control}
        name="displayName"
        idPrefix="create-user"
        autoComplete="off"
        optional
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        label={t('admin.users.fields.displayName')}
        description={t('admin.users.fields.displayNameHelp')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name="role"
          idPrefix="create-user"
          label={t('admin.users.fields.role')}
        >
          {({ field, controlProps }) => (
            <SelectInput
              {...controlProps}
              name={field.name}
              value={field.value}
              onBlur={field.onBlur}
              onValueChange={field.onChange}
              options={USER_ROLES.map((role) => ({
                value: role,
                label: t(`admin.users.roles.${role}`),
              }))}
            />
          )}
        </FormField>
        <FormField
          control={control}
          name="locale"
          idPrefix="create-user"
          label={t('admin.users.fields.locale')}
        >
          {({ field, controlProps }) => (
            <SelectInput
              {...controlProps}
              name={field.name}
              value={field.value}
              onBlur={field.onBlur}
              onValueChange={field.onChange}
              options={LOCALES.map((locale) => ({
                value: locale,
                label: t(`admin.locales.${locale}`),
              }))}
            />
          )}
        </FormField>
      </div>
      <FormField
        control={control}
        name="password"
        idPrefix="create-user"
        optional
        label={t('admin.users.fields.password')}
        description={t('admin.users.fields.passwordHelp', { count: PASSWORD_MIN_LENGTH })}
      >
        {({ field, controlProps }) => (
          <PasswordInput autoComplete="new-password" {...field} {...controlProps} />
        )}
      </FormField>
      {passwordEmpty ? (
        <p className="text-muted-foreground border-l-2 pl-3 text-sm" role="note">
          {t('admin.users.create.welcomeNote')}
        </p>
      ) : null}
      <QuotaField control={control} idPrefix="create-user" />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('common.actions.cancel')}
        </Button>
        <Button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>
          {mutation.isPending ? t('common.actions.working') : t('common.actions.create')}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---- Edit ------------------------------------------------------------------------------------
const editFormSchema = z
  .object({
    displayName: displayNameField,
    role: z.enum(USER_ROLES),
    locale: z.enum(LOCALES),
    disabled: z.boolean(),
    ...quotaShape,
  })
  .refine(checkQuota, { path: ['quotaValue'], error: 'admin.users.errors.quotaInvalid' });
type EditFormValues = z.infer<typeof editFormSchema>;

interface EditUserDialogProps extends DialogProps {
  user: AdminUser | null;
  /** Id of the logged-in admin: role and disabled flag of one's own account are locked. */
  currentUserId: string | undefined;
}

export function EditUserDialog({ open, onOpenChange, user, currentUserId }: EditUserDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open && user !== null} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>{t('admin.users.edit.title')}</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        {user ? (
          <EditUserForm
            user={user}
            isSelf={user.id === currentUserId}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditUserForm({
  user,
  isSelf,
  onDone,
}: {
  user: AdminUser;
  isSelf: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateUsers();
  const [formError, setFormError] = useState<string | null>(null);
  const quota = bytesToQuotaFields(user.quotaBytes);
  const form = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      displayName: user.displayName ?? '',
      role: user.role,
      locale: user.locale,
      disabled: user.disabled,
      quotaValue: quota.value,
      quotaUnit: quota.unit,
    },
  });
  const { control, handleSubmit, formState } = form;

  const mutation = useMutation({
    mutationFn: (patch: UpdateUserRequest) => updateUser(user.id, patch),
    onSuccess: async () => {
      await invalidate();
      notifySuccess(t('admin.users.edit.savedToast'));
      onDone();
    },
    onError: (error) => setFormError(errorMessage(t, error)),
  });

  const submit = (values: EditFormValues) => {
    setFormError(null);
    const patch: UpdateUserRequest = {};
    if (values.role !== user.role) patch.role = values.role;
    if (values.locale !== user.locale) patch.locale = values.locale;
    if (values.disabled !== user.disabled) patch.disabled = values.disabled;
    const name = values.displayName.trim() || null;
    if (name !== user.displayName) patch.displayName = name;
    const quotaBytes = quotaToBytes(values.quotaValue, values.quotaUnit) ?? null;
    if (quotaBytes !== user.quotaBytes) patch.quotaBytes = quotaBytes;
    if (Object.keys(patch).length === 0) {
      onDone();
      return;
    }
    mutation.mutate(patch);
  };

  return (
    <form noValidate className="space-y-4" onSubmit={(event) => void handleSubmit(submit)(event)}>
      <FormErrorSummary
        errors={formState.errors}
        submitCount={formState.submitCount}
        idPrefix="edit-user"
      />
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      <TextField
        control={control}
        name="displayName"
        idPrefix="edit-user"
        autoComplete="off"
        optional
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        label={t('admin.users.fields.displayName')}
        description={t('admin.users.fields.displayNameHelp')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name="role"
          idPrefix="edit-user"
          label={t('admin.users.fields.role')}
          description={isSelf ? t('admin.users.edit.selfLocked') : undefined}
        >
          {({ field, controlProps }) => (
            <SelectInput
              disabled={isSelf}
              {...controlProps}
              name={field.name}
              value={field.value}
              onBlur={field.onBlur}
              onValueChange={field.onChange}
              options={USER_ROLES.map((role) => ({
                value: role,
                label: t(`admin.users.roles.${role}`),
              }))}
            />
          )}
        </FormField>
        <FormField
          control={control}
          name="locale"
          idPrefix="edit-user"
          label={t('admin.users.fields.locale')}
        >
          {({ field, controlProps }) => (
            <SelectInput
              {...controlProps}
              name={field.name}
              value={field.value}
              onBlur={field.onBlur}
              onValueChange={field.onChange}
              options={LOCALES.map((locale) => ({
                value: locale,
                label: t(`admin.locales.${locale}`),
              }))}
            />
          )}
        </FormField>
      </div>
      <QuotaField control={control} idPrefix="edit-user" />
      <CheckboxField
        control={control}
        name="disabled"
        idPrefix="edit-user"
        disabled={isSelf}
        label={t('admin.users.fields.disabled')}
        description={t('admin.users.fields.disabledHelp')}
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('common.actions.cancel')}
        </Button>
        <Button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>
          {mutation.isPending ? t('common.actions.saving') : t('common.actions.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---- Delete ----------------------------------------------------------------------------------
interface DeleteUserDialogProps extends DialogProps {
  user: AdminUser | null;
}

export function DeleteUserDialog({ open, onOpenChange, user }: DeleteUserDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open && user !== null} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>{t('admin.users.delete.title')}</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        {user ? <DeleteUserForm user={user} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserForm({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidateUsers();
  const [mode, setMode] = useState<'delete' | 'reassign'>('delete');
  const [target, setTarget] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const candidates = useQuery({
    queryKey: queryKeys.admin.users({ pageSize: 100, purpose: 'reassign' }),
    queryFn: () => listUsers({ pageSize: 100 }),
    enabled: mode === 'reassign',
  });
  const options = (candidates.data?.items ?? []).filter(
    (candidate) => candidate.id !== user.id && !candidate.disabled,
  );

  const mutation = useMutation({
    mutationFn: () =>
      deleteUser(
        user.id,
        mode === 'reassign'
          ? { transfers: 'reassign', reassignTo: target }
          : { transfers: 'delete' },
      ),
    onSuccess: async () => {
      await invalidate();
      notifySuccess(t('admin.users.delete.deletedToast', { email: user.email }));
      onDone();
    },
    onError: async (error) => {
      setFormError(errorMessage(t, error));
      if (isApiError(error) && error.code === 'USER_NOT_FOUND') await invalidate();
    },
  });

  const needsTarget = mode === 'reassign' && target === '';

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (needsTarget) return;
        setFormError(null);
        mutation.mutate();
      }}
    >
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{t('admin.users.delete.question')}</legend>
        <RadioGroup
          name="delete-mode"
          value={mode}
          onValueChange={(value) => setMode(value === 'reassign' ? 'reassign' : 'delete')}
        >
          <div className="flex min-h-11 items-start gap-3">
            <RadioGroupItem value="delete" id="delete-mode-delete" className="mt-3.5" />
            <Label htmlFor="delete-mode-delete" className="flex-1 flex-col items-start py-2.5">
              <span className="text-sm font-medium">{t('admin.users.delete.modeDelete')}</span>
              <span className="text-muted-foreground text-sm font-normal">
                {t('admin.users.delete.modeDeleteHelp')}
              </span>
            </Label>
          </div>
          <div className="flex min-h-11 items-start gap-3">
            <RadioGroupItem value="reassign" id="delete-mode-reassign" className="mt-3.5" />
            <Label htmlFor="delete-mode-reassign" className="flex-1 flex-col items-start py-2.5">
              <span className="text-sm font-medium">{t('admin.users.delete.modeReassign')}</span>
              <span className="text-muted-foreground text-sm font-normal">
                {t('admin.users.delete.modeReassignHelp')}
              </span>
            </Label>
          </div>
        </RadioGroup>
      </fieldset>
      {mode === 'reassign' ? (
        <div className="space-y-1.5">
          <Label htmlFor="delete-reassign-target" className="text-sm font-medium">
            {t('admin.users.delete.target')}
          </Label>
          {candidates.isPending ? (
            <LoadingState />
          ) : candidates.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(t, candidates.error)}</AlertDescription>
            </Alert>
          ) : (
            <SelectInput
              id="delete-reassign-target"
              value={target}
              required
              aria-describedby={needsTarget ? 'delete-target-hint' : undefined}
              onValueChange={setTarget}
              placeholder={t('admin.users.delete.targetPlaceholder')}
              options={options.map((candidate) => ({
                value: candidate.id,
                label: candidate.email,
              }))}
            />
          )}
          {needsTarget ? (
            <p id="delete-target-hint" className="text-muted-foreground text-sm">
              {t('admin.users.delete.targetRequired')}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="text-muted-foreground text-sm">{t('admin.users.delete.irreversible')}</p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('common.actions.cancel')}
        </Button>
        <Button
          type="submit"
          variant="destructive"
          disabled={needsTarget || mutation.isPending}
          aria-busy={mutation.isPending}
        >
          {mutation.isPending ? t('common.actions.working') : t('admin.users.delete.confirm')}
        </Button>
      </DialogFooter>
    </form>
  );
}
