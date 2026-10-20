import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { completeSetup } from '@/lib/api/setup';
import { hasErrorCode } from '@/lib/errors';
import { isApiError } from '@/lib/api/client';
import { apiErrorText } from '../auth/helpers';
import { Notice } from '../auth/Notice';
import { StepHeading } from './StepHeading';
import { stepActionsClass, type StepProps, type SetupSummary } from './types';
import type { SetupStepId } from './Stepper';

interface CompleteStepProps extends Pick<StepProps, 'appMode' | 'onFatal'> {
  summary: SetupSummary;
  /** Setup finished: the page refreshes the app state and leaves the wizard. */
  onCompleted: () => void;
  /** The API reports unfinished steps: jump back to the first one. */
  onMissing: (steps: SetupStepId[]) => void;
}

const KNOWN_STEPS: readonly SetupStepId[] = ['admin', 'smtp', 'cloudflare', 'general'];

export function CompleteStep({
  appMode,
  onFatal,
  summary,
  onCompleted,
  onMissing,
}: CompleteStepProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const finish = async () => {
    setError(null);
    setPending(true);
    try {
      await completeSetup();
      onCompleted();
    } catch (e) {
      setPending(false);
      if (onFatal(e)) return;
      if (hasErrorCode(e, 'CONFLICT') && isApiError(e)) {
        const missing = e.details?.['missing'];
        if (Array.isArray(missing)) {
          const steps = KNOWN_STEPS.filter((id) => missing.includes(id));
          if (steps.length > 0) {
            onMissing(steps);
            return;
          }
        }
      }
      setError(apiErrorText(t, e));
    }
  };

  const rows: { label: string; value: string }[] = [];
  if (summary.adminEmail)
    rows.push({ label: t('setup.complete.admin'), value: summary.adminEmail });
  if (summary.smtpHost) {
    rows.push({
      label: t('setup.complete.smtp'),
      value: summary.smtpFrom ? `${summary.smtpHost} (${summary.smtpFrom})` : summary.smtpHost,
    });
  }
  rows.push({
    label: t('setup.complete.domain'),
    value:
      appMode === 'local'
        ? t('setup.complete.domainLocal')
        : (summary.publicUrl ?? t('setup.complete.configured')),
  });
  if (summary.instanceName) {
    rows.push({ label: t('setup.complete.instance'), value: summary.instanceName });
  }

  return (
    <div className="space-y-5">
      <StepHeading description={t('setup.complete.intro')}>{t('setup.complete.title')}</StepHeading>
      <dl className="divide-border border-border divide-y border text-sm">
        {rows.map((row) => (
          <div key={row.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="font-medium break-words">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-sm">{t('setup.complete.afterwards')}</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className={stepActionsClass}>
        <Button type="button" disabled={pending} onClick={() => void finish()}>
          {pending ? t('setup.complete.finishing') : t('setup.complete.finish')}
        </Button>
      </div>
    </div>
  );
}
