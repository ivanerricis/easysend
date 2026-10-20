import { AlertCircle, CheckCircle2, Loader2, Pause, Play, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { isApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { formatBytes, formatDuration, formatSpeed } from '@/lib/format';
import { etaSeconds, percentOf } from '@/features/upload/metrics';
import {
  sentBytes,
  totalBytes,
  type FileStatus,
  type UploadSessionState,
} from '@/features/upload/types';

interface UploadProgressPanelProps {
  state: UploadSessionState;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void | Promise<void>;
  onRetry: () => void;
  /** Return to the form keeping what was typed (only when no draft exists yet). */
  onBack: () => void;
}

/** Message for a polite live region: announced every 10% step, on file completion and on errors. */
export function useProgressAnnouncement(state: UploadSessionState): string {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const last = useRef({ step: -1, phase: state.phase, uploaded: 0 });
  const total = totalBytes(state);
  const percent = percentOf(sentBytes(state), total);
  const uploaded = state.files.filter((f) => f.status === 'uploaded' || f.status === 'ready');
  const lastUploadedName = uploaded[uploaded.length - 1]?.name;

  useEffect(() => {
    const prev = last.current;
    let next: string | null = null;
    if (state.phase !== prev.phase) {
      const key = {
        creating: 'creating',
        uploading: 'resumed',
        paused: 'paused',
        processing: 'processing',
        finalizing: 'finalizing',
        done: 'done',
        error: 'error',
        idle: null,
      }[state.phase];
      if (key && !(state.phase === 'uploading' && prev.phase !== 'paused')) {
        next = t(`transfers.progress.announce.${key}`);
      }
    } else if (uploaded.length > prev.uploaded && lastUploadedName) {
      next = t('transfers.progress.announce.fileDone', { name: lastUploadedName });
    } else if (state.phase === 'uploading') {
      const step = Math.floor(percent / 10);
      if (step > prev.step && step > 0 && step < 10) {
        next = t('transfers.progress.announce.percent', { percent: step * 10 });
      }
    }
    if (state.phase === 'uploading') prev.step = Math.max(prev.step, Math.floor(percent / 10));
    prev.phase = state.phase;
    prev.uploaded = uploaded.length;
    if (next) setMessage(next);
  }, [state.phase, percent, uploaded.length, lastUploadedName, t]);

  return message;
}

function fileStatusKey(status: FileStatus, phase: UploadSessionState['phase']): string {
  if (status === 'uploaded') return phase === 'processing' ? 'encrypting' : 'uploaded';
  return status;
}

/** Progress of a running transfer: total bar, per-file rows, controls and the error state. */
export function UploadProgressPanel({
  state,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onBack,
}: UploadProgressPanelProps) {
  const { t, i18n } = useTranslation();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const announcement = useProgressAnnouncement(state);
  const total = totalBytes(state);
  const sent = sentBytes(state);
  const percent = state.phase === 'done' ? 100 : percentOf(sent, total);
  const uploading = state.phase === 'uploading';
  const eta = uploading ? etaSeconds(sent, total, state.speed) : null;
  const locale = i18n.language;

  const sizes = `${formatBytes(sent, locale)} / ${formatBytes(total, locale)}`;
  const valueText = [
    `${percent}%`,
    t('transfers.progress.ofTotal', {
      sent: formatBytes(sent, locale),
      total: formatBytes(total, locale),
    }),
    eta !== null && eta > 0
      ? t('transfers.progress.etaText', { time: formatDuration(eta, locale) })
      : null,
  ]
    .filter(Boolean)
    .join(', ');

  const headingKey = {
    creating: 'creating',
    uploading: 'uploading',
    paused: 'paused',
    processing: 'processing',
    finalizing: 'finalizing',
    done: 'finalizing',
    error: 'error',
    idle: 'creating',
  }[state.phase];

  const busy =
    state.phase === 'processing' || state.phase === 'finalizing' || state.phase === 'creating';
  const canControl = state.phase === 'uploading' || state.phase === 'paused';
  const hasDraft = state.transferId !== null;
  const rateLimitedFor = isApiError(state.error) ? state.error.retryAfter : undefined;

  return (
    <section aria-labelledby="progress-heading" className="space-y-5">
      <div className="flex items-center gap-2">
        {busy ? (
          <Loader2 aria-hidden="true" className="size-5 shrink-0 motion-safe:animate-spin" />
        ) : state.phase === 'error' ? (
          <AlertCircle aria-hidden="true" className="text-destructive size-5 shrink-0" />
        ) : null}
        <h2 id="progress-heading" className="text-lg font-semibold">
          {t(`transfers.progress.heading.${headingKey}`)}
        </h2>
      </div>

      {state.phase === 'error' ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{t('transfers.progress.errorTitle')}</AlertTitle>
          <AlertDescription>
            {errorMessage(t, state.error)}
            {rateLimitedFor ? ` ${t('errors.retryAfterSeconds', { count: rateLimitedFor })}` : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Progress
          value={percent}
          aria-label={t('transfers.progress.total')}
          aria-valuetext={valueText}
          className="h-3"
        />
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
          <span className="font-mono">
            {percent}% · {sizes}
          </span>
          {uploading ? (
            <span className="text-muted-foreground font-mono text-xs">
              {state.speed > 0 ? formatSpeed(state.speed, locale) : '—'}
              {' · '}
              {eta !== null
                ? t('transfers.progress.eta', { time: formatDuration(eta, locale) })
                : '—'}
            </span>
          ) : null}
        </div>
      </div>

      <ul
        className="divide-border border-border divide-y border"
        aria-label={t('transfers.new.selectedFiles')}
      >
        {state.files.map((file) => {
          const filePercent = file.status === 'queued' ? 0 : percentOf(file.sent, file.size);
          const key = fileStatusKey(file.status, state.phase);
          return (
            <li key={file.key} className="space-y-1.5 px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 text-sm break-all">{file.name}</span>
                <span className="text-muted-foreground shrink-0 font-mono text-xs">
                  {formatBytes(file.size, locale)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {file.status === 'uploaded' || file.status === 'ready' ? (
                  <CheckCircle2 aria-hidden="true" className="text-primary size-3.5" />
                ) : file.status === 'error' ? (
                  <AlertCircle aria-hidden="true" className="text-destructive size-3.5" />
                ) : null}
                <span
                  className={file.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}
                >
                  {t(`transfers.progress.file.${key}`)}
                  {file.status === 'uploading' ? ` · ${filePercent}%` : ''}
                </span>
              </div>
              {file.status === 'uploading' ? (
                <Progress
                  value={filePercent}
                  aria-label={t('transfers.progress.fileProgress', { name: file.name })}
                  aria-valuetext={`${filePercent}%`}
                  className="h-1.5"
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="flex flex-wrap gap-2">
        {state.phase === 'error' ? (
          <>
            <Button type="button" onClick={onRetry}>
              {t('common.actions.retry')}
            </Button>
            {hasDraft ? (
              <Button type="button" variant="outline" onClick={() => setConfirmCancel(true)}>
                {t('transfers.progress.discard')}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={onBack}>
                {t('transfers.progress.backToForm')}
              </Button>
            )}
          </>
        ) : null}
        {canControl ? (
          <>
            {state.phase === 'paused' ? (
              <Button type="button" onClick={onResume}>
                <Play aria-hidden="true" />
                {t('transfers.progress.resume')}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={onPause}>
                <Pause aria-hidden="true" />
                {t('transfers.progress.pause')}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setConfirmCancel(true)}>
              <X aria-hidden="true" />
              {t('common.actions.cancel')}
            </Button>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t('transfers.progress.cancelTitle')}
        description={t('transfers.progress.cancelDescription')}
        confirmLabel={t('transfers.progress.cancelConfirm')}
        cancelLabel={t('transfers.progress.cancelKeep')}
        destructive
        onConfirm={onCancel}
      />
    </section>
  );
}
