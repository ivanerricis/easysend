import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RecoveryCodes } from '@/components/common/RecoveryCodes';
import { Button } from '@/components/ui/button';

interface RecoveryCodesStepProps {
  codes: readonly string[];
  onContinue: () => void;
  continueLabel?: string;
}

/** Recovery codes plus a "continue" button that stays disabled until the user confirms. */
export function RecoveryCodesStep({ codes, onContinue, continueLabel }: RecoveryCodesStepProps) {
  const { t } = useTranslation();
  const hintId = useId();
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="space-y-6">
      <RecoveryCodes codes={codes} confirmed={confirmed} onConfirmedChange={setConfirmed} />
      <div className="space-y-2">
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={!confirmed}
          aria-describedby={confirmed ? undefined : hintId}
          onClick={onContinue}
        >
          {continueLabel ?? t('common.actions.continue')}
        </Button>
        {confirmed ? null : (
          <p id={hintId} className="text-muted-foreground text-sm">
            {t('auth.recoveryConfirmHint')}
          </p>
        )}
      </div>
    </div>
  );
}
