import { TOTP_CODE_LENGTH } from '@easysend/shared';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { useTranslation } from 'react-i18next';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once all 6 digits are entered. */
  onComplete?: (value: string) => void;
  id?: string;
  /** Accessible name; defaults to "6-digit code". Use a visible `<label htmlFor={id}>` if you can. */
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}

/** Six-digit one-time code input (numeric keypad on mobile, one-time-code autofill). */
export function OtpInput({
  value,
  onChange,
  onComplete,
  id,
  disabled,
  autoFocus,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: OtpInputProps) {
  const { t } = useTranslation();
  return (
    <InputOTP
      id={id}
      maxLength={TOTP_CODE_LENGTH}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      // eslint-disable-next-line jsx-a11y/no-autofocus -- opt-in prop for the code step of a flow
      autoFocus={autoFocus}
      aria-label={ariaLabel ?? t('common.otp.label')}
      aria-describedby={describedBy}
      aria-invalid={invalid}
    >
      <InputOTPGroup>
        {Array.from({ length: TOTP_CODE_LENGTH }, (_, index) => (
          <InputOTPSlot key={index} index={index} aria-invalid={invalid} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
