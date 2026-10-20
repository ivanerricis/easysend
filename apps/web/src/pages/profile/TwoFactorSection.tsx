import { PASSWORD_MAX_LENGTH, TOTP_CODE_LENGTH } from '@easysend/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useSession } from '@/app/providers/SessionProvider';
import { queryKeys } from '@/app/query';
import { CopyButton } from '@/components/common/CopyButton';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField, fieldId } from '@/components/common/FormField';
import { OtpInput } from '@/components/common/OtpInput';
import { PasswordInput } from '@/components/common/PasswordInput';
import { QrCode } from '@/components/common/QrCode';
import { RecoveryCodes } from '@/components/common/RecoveryCodes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { disable2fa, enable2fa, regenerateRecoveryCodes, start2faSetup } from '@/lib/api/me';
import { errorMessage, hasErrorCode } from '@/lib/errors';
import { notifySuccess } from '@/lib/toast';
import { lockMessage } from './lock-message';
import { Section } from './Section';

const reauthFormSchema = z.object({
  password: z.string().min(1, 'profile.twoFactor.errors.passwordRequired').max(PASSWORD_MAX_LENGTH),
  code: z.string().regex(new RegExp(`^[0-9]{${TOTP_CODE_LENGTH}}$`), {
    message: 'profile.twoFactor.errors.codeRequired',
  }),
});
type ReauthForm = z.infer<typeof reauthFormSchema>;

type Mode =
  | { kind: 'idle' }
  | { kind: 'setup'; secret: string; uri: string }
  | { kind: 'codes'; codes: readonly string[]; note: string }
  | { kind: 'regenerate' }
  | { kind: 'disable' };

/** Password + current TOTP code, used to regenerate recovery codes or disable 2FA. */
function ReauthPanel({
  action,
  onDone,
  onCancel,
}: {
  action: 'regenerate' | 'disable';
  onDone: (codes: readonly string[] | null) => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, submitCount, isSubmitting },
  } = useForm<ReauthForm>({
    resolver: zodResolver(reauthFormSchema),
    defaultValues: { password: '', code: '' },
  });
  const prefix = `reauth-${action}`;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (action === 'regenerate') {
        const result = await regenerateRecoveryCodes(values);
        onDone(result.recoveryCodes);
      } else {
        await disable2fa(values);
        onDone(null);
      }
    } catch (error) {
      if (hasErrorCode(error, 'PASSWORD_INCORRECT')) {
        setError('password', { message: errorMessage(t, error) });
        setFocus('password');
      } else if (hasErrorCode(error, 'INVALID_TOTP_CODE')) {
        setError('code', { message: errorMessage(t, error) });
      } else if (hasErrorCode(error, 'RATE_LIMITED', 'ACCOUNT_LOCKED')) {
        setFormError(lockMessage(t, i18n.language, error));
      } else {
        setFormError(errorMessage(t, error));
      }
    }
  });

  const help =
    action === 'regenerate'
      ? t('profile.twoFactor.regenerateHelp')
      : t('profile.twoFactor.disableHelp');

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4 border-t pt-4">
      <p className="text-muted-foreground text-sm">{help}</p>
      <FormErrorSummary errors={errors} submitCount={submitCount} idPrefix={prefix} />
      <FormField
        control={control}
        name="password"
        idPrefix={prefix}
        label={t('profile.twoFactor.reauthPassword')}
      >
        {({ field, controlProps }) => (
          <PasswordInput autoComplete="current-password" {...field} {...controlProps} />
        )}
      </FormField>
      <FormField
        control={control}
        name="code"
        idPrefix={prefix}
        label={t('profile.twoFactor.reauthCode')}
      >
        {({ field, controlProps }) => (
          <OtpInput
            value={field.value}
            onChange={field.onChange}
            aria-label={t('profile.twoFactor.reauthCode')}
            id={controlProps.id}
            aria-invalid={controlProps['aria-invalid']}
            aria-describedby={controlProps['aria-describedby']}
          />
        )}
      </FormField>
      {formError ? (
        <p role="alert" className="text-destructive text-sm">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant={action === 'disable' ? 'destructive' : 'default'}
          disabled={isSubmitting}
        >
          {action === 'regenerate'
            ? t('profile.twoFactor.regenerateSubmit')
            : t('profile.twoFactor.disableSubmit')}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('profile.twoFactor.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** QR code + manual key + first code: confirms the enrolment and returns the recovery codes. */
function SetupPanel({
  secret,
  uri,
  onEnabled,
  onCancel,
  onRestart,
}: {
  secret: string;
  uri: string;
  onEnabled: (codes: readonly string[]) => void;
  onCancel: () => void;
  onRestart: () => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeId = fieldId('code', 'setup2fa');
  const errorId = `${codeId}-error`;

  const verify = async () => {
    if (code.length !== TOTP_CODE_LENGTH) {
      setError(t('profile.twoFactor.errors.codeRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await enable2fa({ code });
      onEnabled(result.recoveryCodes);
    } catch (e) {
      if (hasErrorCode(e, 'CONFLICT')) {
        // The pending enrolment is gone: start again.
        onRestart();
        return;
      }
      setError(errorMessage(t, e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void verify();
      }}
      noValidate
      className="space-y-4 border-t pt-4"
    >
      <p className="text-sm">{t('profile.twoFactor.scan')}</p>
      <QrCode value={uri} />
      <div className="space-y-1">
        <p className="text-sm font-medium">{t('profile.twoFactor.secretLabel')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="bg-muted px-2 py-1 font-mono text-sm break-all">{secret}</code>
          <CopyButton value={secret} variant="outline">
            {t('profile.twoFactor.copySecret')}
          </CopyButton>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={codeId}>{t('profile.twoFactor.codeLabel')}</Label>
        <OtpInput
          id={codeId}
          value={code}
          onChange={setCode}
          aria-label={t('profile.twoFactor.codeLabel')}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
        />
        {error ? (
          <p id={errorId} role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? t('profile.twoFactor.verifying') : t('profile.twoFactor.verify')}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('profile.twoFactor.cancel')}
        </Button>
      </div>
    </form>
  );
}

function CodesPanel({
  codes,
  note,
  onDone,
}: {
  codes: readonly string[];
  note: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="space-y-4 border-t pt-4">
      <p className="text-sm">{note}</p>
      <RecoveryCodes codes={codes} confirmed={confirmed} onConfirmedChange={setConfirmed} />
      <Button type="button" disabled={!confirmed} onClick={onDone}>
        {t('profile.twoFactor.codesDone')}
      </Button>
    </div>
  );
}

export function TwoFactorSection() {
  const { t } = useTranslation();
  const { user, setSessionUser, isAdmin } = useSession();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  if (!user) return null;
  const enabled = user.totpEnabled;

  const updateUser = (totpEnabled: boolean) => {
    setSessionUser({ ...user, totpEnabled });
    void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  };

  const startSetup = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const result = await start2faSetup();
      setMode({ kind: 'setup', secret: result.secret, uri: result.otpauthUri });
    } catch (error) {
      setStartError(errorMessage(t, error));
    } finally {
      setStarting(false);
    }
  };

  const idle = mode.kind === 'idle';

  return (
    <Section title={t('profile.twoFactor.title')} description={t('profile.twoFactor.description')}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={enabled ? 'default' : 'outline'}>
          {enabled ? t('profile.twoFactor.statusOn') : t('profile.twoFactor.statusOff')}
        </Badge>
      </div>

      {mode.kind === 'setup' ? (
        <SetupPanel
          secret={mode.secret}
          uri={mode.uri}
          onCancel={() => setMode({ kind: 'idle' })}
          onRestart={() => {
            setMode({ kind: 'idle' });
            void startSetup();
          }}
          onEnabled={(codes) => {
            updateUser(true);
            setMode({ kind: 'codes', codes, note: t('profile.twoFactor.codesEnabledNote') });
          }}
        />
      ) : null}

      {mode.kind === 'codes' ? (
        <CodesPanel codes={mode.codes} note={mode.note} onDone={() => setMode({ kind: 'idle' })} />
      ) : null}

      {mode.kind === 'regenerate' || mode.kind === 'disable' ? (
        <ReauthPanel
          action={mode.kind}
          onCancel={() => setMode({ kind: 'idle' })}
          onDone={(codes) => {
            if (codes) {
              setMode({
                kind: 'codes',
                codes,
                note: t('profile.twoFactor.codesRegeneratedNote'),
              });
            } else {
              updateUser(false);
              setMode({ kind: 'idle' });
              notifySuccess(t('profile.twoFactor.disabledDone'));
            }
          }}
        />
      ) : null}

      {idle && !enabled ? (
        <div className="space-y-2">
          <Button type="button" onClick={() => void startSetup()} disabled={starting}>
            {starting ? t('profile.twoFactor.starting') : t('profile.twoFactor.enable')}
          </Button>
          {startError ? (
            <p role="alert" className="text-destructive text-sm">
              {startError}
            </p>
          ) : null}
        </div>
      ) : null}

      {idle && enabled ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setMode({ kind: 'regenerate' })}>
              {t('profile.twoFactor.regenerate')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isAdmin}
              aria-describedby={isAdmin ? 'twofactor-admin-note' : undefined}
              onClick={() => setMode({ kind: 'disable' })}
            >
              {t('profile.twoFactor.disable')}
            </Button>
          </div>
          {isAdmin ? (
            <p id="twofactor-admin-note" className="text-muted-foreground text-sm">
              {t('profile.twoFactor.adminRequired')}
            </p>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}
