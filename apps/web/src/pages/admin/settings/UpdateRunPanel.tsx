import type { PendingUpdate, UpdateRunResponse, UpdateRunStatus } from '@easysend/shared';
import { AlertTriangle, CheckCircle2, Circle, CircleAlert, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '@/components/common/CopyButton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

/** Where the commands are run: the folder of the production install (see the deploy guide). */
export const INSTALL_DIR = '/opt/easysend';
export const UPDATE_LOG_PATH = `${INSTALL_DIR}/.deploy/update.log`;

/** Steps shown in order; `rollback` is appended only when the runner reports it. */
const MAIN_STEPS = [
  'requested',
  'starting',
  'compose',
  'backup',
  'pull',
  'restart',
  'health',
] as const;
type StepKey = (typeof MAIN_STEPS)[number] | 'rollback';

export function CommandBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-2">
      <pre
        role="group"
        aria-label={label}
        className="bg-muted p-3 font-mono text-sm break-words whitespace-pre-wrap"
      >
        <code>{value}</code>
      </pre>
      <CopyButton value={value} />
    </div>
  );
}

function currentStep(pending: PendingUpdate | null, run: UpdateRunStatus | null): StepKey {
  if (run && (!pending || pending.id === run.id) && run.state === 'running') {
    if (run.step === 'rollback') return 'rollback';
    if (run.step === 'done') return 'health';
    return run.step;
  }
  return 'requested';
}

interface ProgressProps {
  data: UpdateRunResponse;
  restarting: boolean;
  signedOut: boolean;
  onRequestAgain: (version: string) => void;
  requesting: boolean;
}

/** Ordered steps, a progress bar and a polite live region while an update is active. */
export function UpdateProgress({
  data,
  restarting,
  signedOut,
  onRequestAgain,
  requesting,
}: ProgressProps) {
  const { t } = useTranslation();
  const { pending, run } = data;
  const version = pending?.version ?? run?.targetVersion ?? '';
  const current = currentStep(pending, run);
  const steps: StepKey[] = current === 'rollback' ? [...MAIN_STEPS, 'rollback'] : [...MAIN_STEPS];
  const index = steps.indexOf(current);
  const percent = Math.round(((index + 1) / (MAIN_STEPS.length + 1)) * 100);
  const stepText = t(`admin.settings.updates.oneClick.steps.${current}`);

  return (
    <div className="ring-foreground/10 space-y-4 p-4 ring-1" data-testid="update-progress">
      <h3 className="font-medium">
        {t('admin.settings.updates.oneClick.progressTitle', { version })}
      </h3>
      <Progress
        value={percent}
        aria-label={t('admin.settings.updates.oneClick.progressLabel')}
        aria-valuetext={stepText}
      />
      <div role="status" aria-live="polite" className="text-sm">
        <p>
          {t('admin.settings.updates.oneClick.stepCount', {
            current: index + 1,
            total: MAIN_STEPS.length,
            step: stepText,
          })}
        </p>
        {restarting ? (
          <p className="text-muted-foreground">{t('admin.settings.updates.oneClick.restarting')}</p>
        ) : null}
      </div>
      <ol
        aria-label={t('admin.settings.updates.oneClick.stepsLabel')}
        className="space-y-2 text-sm"
      >
        {steps.map((step, i) => {
          const state = i < index ? 'done' : i === index ? 'current' : 'todo';
          const Icon = state === 'done' ? CheckCircle2 : state === 'current' ? Loader2 : Circle;
          return (
            <li
              key={step}
              aria-current={state === 'current' ? 'step' : undefined}
              className={`flex items-start gap-2 ${state === 'todo' ? 'text-muted-foreground' : ''} ${
                state === 'current' ? 'font-medium' : ''
              }`}
            >
              <Icon
                aria-hidden="true"
                className={`mt-0.5 size-4 shrink-0 ${
                  state === 'current' ? 'animate-spin motion-reduce:animate-none' : ''
                }`}
              />
              <span>
                {t(`admin.settings.updates.oneClick.steps.${step}`)}{' '}
                <span className="sr-only">
                  {t(`admin.settings.updates.oneClick.stepStatus.${state}`)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      {signedOut ? (
        <Alert>
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{t('admin.settings.updates.oneClick.signedOut')}</AlertDescription>
        </Alert>
      ) : null}
      {pending?.stale ? (
        <Alert>
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{t('admin.settings.updates.oneClick.staleTitle')}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{t('admin.settings.updates.oneClick.staleBody')}</p>
            <CommandBlock
              label={t('admin.settings.updates.oneClick.staleCommands')}
              value={`cd ${INSTALL_DIR}\nsudo ./scripts/update-service.sh status\ntail -n 50 ${UPDATE_LOG_PATH}`}
            />
            <Button
              type="button"
              variant="outline"
              disabled={requesting}
              onClick={() => onRequestAgain(pending.version)}
            >
              {t('admin.settings.updates.oneClick.requestAgain')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** Outcome of the last finished run (shown until the next update starts). */
export function UpdateOutcome({ run }: { run: UpdateRunStatus }) {
  const { t } = useTranslation();
  const to = run.targetVersion ?? '';
  const from = run.fromVersion ?? '';

  if (run.error === 'already_current') {
    return (
      <Alert role="status">
        <CheckCircle2 aria-hidden="true" />
        <AlertTitle>
          {t('admin.settings.updates.oneClick.alreadyCurrentTitle', { version: to })}
        </AlertTitle>
        <AlertDescription>
          {t('admin.settings.updates.oneClick.alreadyCurrentBody')}
        </AlertDescription>
      </Alert>
    );
  }
  if (run.state === 'succeeded') {
    return (
      <Alert role="status">
        <CheckCircle2 aria-hidden="true" />
        <AlertTitle>
          {t('admin.settings.updates.oneClick.succeededTitle', { version: to })}
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{t('admin.settings.updates.oneClick.succeededBody')}</p>
          <Button type="button" onClick={() => window.location.reload()}>
            {t('admin.settings.updates.oneClick.reload')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (run.state === 'rolled_back') {
    return (
      <Alert>
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>{t('admin.settings.updates.oneClick.rolledBackTitle', { to })}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{t('admin.settings.updates.oneClick.rolledBackBody', { from })}</p>
          <code className="bg-muted block p-2 font-mono break-all">{UPDATE_LOG_PATH}</code>
        </AlertDescription>
      </Alert>
    );
  }
  if (run.state === 'failed') {
    const known = run.error ?? 'unknown';
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>{t('admin.settings.updates.oneClick.failedTitle', { version: to })}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{t(`admin.settings.updates.oneClick.failed.${known}`)}</p>
          <p>{t('admin.settings.updates.oneClick.logPath')}:</p>
          <code className="bg-muted block p-2 font-mono break-all">{UPDATE_LOG_PATH}</code>
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}
