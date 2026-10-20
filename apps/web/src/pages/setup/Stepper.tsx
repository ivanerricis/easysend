import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export const SETUP_STEPS = ['code', 'admin', 'smtp', 'cloudflare', 'general', 'complete'] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];

interface StepperProps {
  current: SetupStepId;
  /** Local mode: the Cloudflare step is shown as skipped instead of done. */
  cloudflareSkipped?: boolean;
}

/**
 * Progress list of the wizard. State is written as text ("Done", "Current step", "To do"), not
 * only with colour; the current item has `aria-current="step"`.
 */
export function Stepper({ current, cloudflareSkipped }: StepperProps) {
  const { t } = useTranslation();
  const currentIndex = SETUP_STEPS.indexOf(current);
  return (
    <nav aria-label={t('setup.stepper.label')} className="mb-8">
      <ol className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
        {SETUP_STEPS.map((id, index) => {
          const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
          const skipped = id === 'cloudflare' && state === 'done' && cloudflareSkipped;
          return (
            <li
              key={id}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'flex min-h-11 items-center gap-3 border px-3 py-1.5',
                state === 'current' ? 'border-primary border-2' : 'border-border',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center border text-xs font-medium',
                  state === 'done' && 'bg-primary text-primary-foreground border-primary',
                  state === 'current' && 'border-primary text-primary',
                )}
              >
                {state === 'done' ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className="min-w-0 text-sm leading-tight">
                <span className={cn('block truncate', state === 'current' && 'font-semibold')}>
                  {t(`setup.stepper.${id}`)}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {skipped ? t('setup.stepper.skipped') : t(`setup.stepper.${state}`)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
