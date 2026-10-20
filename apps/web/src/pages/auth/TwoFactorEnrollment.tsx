import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '@/components/common/CopyButton';
import { OtpInput } from '@/components/common/OtpInput';
import { QrCode } from '@/components/common/QrCode';
import { Button } from '@/components/ui/button';
import { apiErrorText, groupSecret } from './helpers';

interface TwoFactorEnrollmentProps {
  secret: string;
  otpauthUri: string;
  /** Verifies the code; throws an ApiError when it is wrong. */
  onVerify: (code: string) => Promise<void>;
  /** Label of the submit button. */
  submitLabel?: string;
}

/**
 * Authenticator enrolment: install an app, scan the QR code (or type the key), enter the first
 * code. The code is submitted automatically when the sixth digit is entered, and with the button.
 */
export function TwoFactorEnrollment({
  secret,
  otpauthUri,
  onVerify,
  submitLabel,
}: TwoFactorEnrollmentProps) {
  const { t } = useTranslation();
  const id = useId();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inflight = useRef(false);

  const submit = async (value: string) => {
    if (inflight.current || value.length !== 6) return;
    inflight.current = true;
    setPending(true);
    setError(null);
    try {
      await onVerify(value);
    } catch (e) {
      setError(apiErrorText(t, e));
      setCode('');
    } finally {
      inflight.current = false;
      setPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <ol className="space-y-6">
        <li className="space-y-1">
          <p className="font-medium">{t('auth.enroll.step1Title')}</p>
          <p className="text-muted-foreground text-sm">{t('auth.enroll.step1Body')}</p>
        </li>
        <li className="space-y-3">
          <p className="font-medium">{t('auth.enroll.step2Title')}</p>
          <QrCode value={otpauthUri} />
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm" id={`${id}-secret-label`}>
              {t('auth.enroll.manualKey')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code
                aria-labelledby={`${id}-secret-label`}
                className="bg-muted min-w-0 px-3 py-2 font-mono text-sm tracking-wider break-all"
              >
                {groupSecret(secret)}
              </code>
              <CopyButton value={secret} toast={false}>
                {t('auth.enroll.copyKey')}
              </CopyButton>
            </div>
          </div>
        </li>
        <li className="space-y-3">
          <label htmlFor={`${id}-otp`} className="block font-medium">
            {t('auth.enroll.step3Title')}
          </label>
          <OtpInput
            id={`${id}-otp`}
            aria-label={t('auth.enroll.step3Title')}
            value={code}
            onChange={setCode}
            onComplete={(value) => void submit(value)}
            disabled={pending}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={error ? true : undefined}
          />
          {error ? (
            <p id={`${id}-error`} role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <div aria-live="polite" className="text-muted-foreground min-h-5 text-sm">
            {pending ? t('auth.verifying') : ''}
          </div>
        </li>
      </ol>
      <Button
        type="button"
        className="w-full sm:w-auto"
        disabled={pending || code.length !== 6}
        onClick={() => void submit(code)}
      >
        {submitLabel ?? t('auth.enroll.verify')}
      </Button>
    </div>
  );
}
