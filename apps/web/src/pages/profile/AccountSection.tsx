import { DISPLAY_NAME_MAX_LENGTH, type User } from '@easysend/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useSession } from '@/app/providers/SessionProvider';
import { queryKeys } from '@/app/query';
import { TextField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { updateMe } from '@/lib/api/me';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { notifyError, notifySuccess } from '@/lib/toast';
import { Section } from './Section';

const accountSchema = z.object({
  displayName: z.string().trim().max(DISPLAY_NAME_MAX_LENGTH, 'profile.account.displayNameTooLong'),
});
type AccountForm = z.infer<typeof accountSchema>;

export function AccountSection() {
  const { user } = useSession();
  return user ? <AccountForm user={user} /> : null;
}

function AccountForm({ user }: { user: User }) {
  const { t, i18n } = useTranslation();
  const { setSessionUser } = useSession();
  const queryClient = useQueryClient();
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, isDirty },
  } = useForm<AccountForm>({
    resolver: zodResolver(accountSchema),
    defaultValues: { displayName: user.displayName ?? '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await updateMe({
        displayName: values.displayName === '' ? null : values.displayName,
      });
      setSessionUser(result.user);
      queryClient.setQueryData(queryKeys.me, result);
      reset({ displayName: result.user.displayName ?? '' });
      notifySuccess(t('profile.account.saved'));
    } catch (error) {
      notifyError(errorMessage(t, error));
    }
  });

  const rows: [string, string][] = [
    [t('profile.account.email'), user.email],
    [
      t('profile.account.role'),
      user.role === 'admin' ? t('profile.account.roleAdmin') : t('profile.account.roleUser'),
    ],
    [t('profile.account.created'), formatDateTime(user.createdAt, i18n.language)],
    [
      t('profile.account.lastLogin'),
      user.lastLoginAt
        ? formatDateTime(user.lastLoginAt, i18n.language)
        : t('profile.account.never'),
    ],
  ];

  return (
    <Section title={t('profile.account.title')}>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        <TextField
          control={control}
          name="displayName"
          idPrefix="profile"
          label={t('profile.account.displayName')}
          description={t('profile.account.displayNameHelp')}
          autoComplete="nickname"
          optional
        />
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? t('common.actions.saving') : t('common.actions.save')}
        </Button>
      </form>
    </Section>
  );
}
