import { PASSWORD_MAX_LENGTH, type DownloadFile } from '@easysend/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, FileArchive, Lock } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { z } from 'zod';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { queryKeys } from '@/app/query';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { PasswordInput } from '@/components/common/PasswordInput';
import { LoadingState } from '@/components/common/States';
import { PublicCard } from '@/components/layout/PublicLayout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { isApiError } from '@/lib/api/client';
import {
  downloadFileUrl,
  downloadZipUrl,
  getDownloadInfo,
  unlockDownload,
} from '@/lib/api/downloads';
import { formatBytes, formatDateTime, formatDuration, formatRelative } from '@/lib/format';
import { hasErrorCode } from '@/lib/errors';

/** Delay before the counter is refetched after a download link was clicked. */
export const REFETCH_DELAY_MS = 2000;
/** Warn the recipient when this many downloads (or fewer) are left. */
const LOW_DOWNLOADS_THRESHOLD = 3;

const unlockFormSchema = z.object({
  password: z.string().min(1, 'download.locked.required').max(PASSWORD_MAX_LENGTH),
});
type UnlockForm = z.infer<typeof unlockFormSchema>;

function errorStateKey(error: unknown): string {
  if (!isApiError(error)) return 'generic';
  switch (error.code) {
    case 'TRANSFER_NOT_FOUND':
      return 'notFound';
    case 'TRANSFER_EXPIRED':
      return 'expired';
    case 'TRANSFER_REVOKED':
      return 'revoked';
    case 'DOWNLOAD_LIMIT_REACHED':
      return 'limit';
    case 'RATE_LIMITED':
      return 'rateLimited';
    default:
      return 'generic';
  }
}

/** Full-page state with its own h1 (not found, expired, revoked, limit, rate limit, generic). */
function ErrorView({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const key = errorStateKey(error);
  const retryable = key === 'rateLimited' || key === 'generic';
  const requestId = isApiError(error) ? error.requestId : undefined;
  return (
    <PublicCard width="default">
      <PageHeader title={t(`download.states.${key}.title`)} />
      <p className="text-muted-foreground text-sm">{t(`download.states.${key}.description`)}</p>
      {key === 'generic' && requestId ? (
        <p className="text-muted-foreground mt-3 text-xs">
          {t('common.states.requestId')}: <code className="font-mono">{requestId}</code>
        </p>
      ) : null}
      {retryable ? (
        <Button type="button" variant="outline" className="mt-6" onClick={onRetry}>
          {t('common.actions.retry')}
        </Button>
      ) : null}
    </PublicCard>
  );
}

function UnlockView({
  token,
  expiresAt,
  onUnlocked,
}: {
  token: string;
  expiresAt: number;
  onUnlocked: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setFocus,
    formState: { errors, submitCount, isSubmitting },
  } = useForm<UnlockForm>({
    resolver: zodResolver(unlockFormSchema),
    defaultValues: { password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await unlockDownload(token, values);
      await onUnlocked();
    } catch (error) {
      if (hasErrorCode(error, 'PASSWORD_INCORRECT')) {
        setServerError(t('errors.PASSWORD_INCORRECT'));
        setFocus('password');
      } else if (hasErrorCode(error, 'RATE_LIMITED') && isApiError(error)) {
        setServerError(
          error.retryAfter
            ? t('download.locked.retryIn', {
                time: formatDuration(error.retryAfter, i18n.language),
              })
            : t('errors.RATE_LIMITED'),
        );
      } else {
        // Expired, revoked, deleted...: reload the info to show the matching state.
        await onUnlocked();
      }
    }
  });

  return (
    <PublicCard width="narrow">
      <PageHeader
        title={t('download.locked.title')}
        description={t('download.locked.description')}
      />
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        <FormErrorSummary errors={errors} submitCount={submitCount} />
        <FormField control={control} name="password" label={t('download.locked.password')}>
          {({ field, controlProps }) => (
            <PasswordInput
              autoComplete="off"
              {...field}
              {...controlProps}
              aria-invalid={controlProps['aria-invalid'] || serverError !== null}
              aria-describedby={
                [controlProps['aria-describedby'], serverError ? 'unlock-error' : undefined]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
            />
          )}
        </FormField>
        {serverError ? (
          <p id="unlock-error" role="alert" className="text-destructive text-sm">
            {serverError}
          </p>
        ) : null}
        <p className="text-muted-foreground text-sm">
          {t('download.expires', {
            date: formatDateTime(expiresAt, i18n.language),
            relative: formatRelative(expiresAt, i18n.language),
          })}
        </p>
        <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
          <Lock aria-hidden="true" />
          {isSubmitting ? t('download.locked.submitting') : t('download.locked.submit')}
        </Button>
      </form>
    </PublicCard>
  );
}

interface TransferViewProps {
  token: string;
  info: Extract<Awaited<ReturnType<typeof getDownloadInfo>>, { locked: false }>;
  onDownloadStarted: () => void;
}

function TransferView({ token, info, onDownloadStarted }: TransferViewProps) {
  const { t, i18n } = useTranslation();
  const { instanceName } = useAppearance();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const locale = i18n.language;

  const files: readonly DownloadFile[] = info.files;
  const selectedIds = useMemo(
    () => files.filter((file) => selected.has(file.id)).map((file) => file.id),
    [files, selected],
  );
  const allSelected = files.length > 0 && selectedIds.length === files.length;

  const toggle = (id: string, on: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const started = () => {
    setAnnouncement('');
    // Re-set after a tick so repeated clicks are announced again.
    window.setTimeout(() => setAnnouncement(t('download.started')), 50);
    onDownloadStarted();
  };

  const remaining = info.maxDownloads === null ? null : info.maxDownloads - info.downloadCount;
  const sender = info.senderName ?? instanceName;
  const zipHint = 'download-zip-hint';

  return (
    <PublicCard width="wide">
      <p className="text-muted-foreground mb-2 text-sm">{t('download.sentBy', { name: sender })}</p>
      <PageHeader title={info.title ?? t('download.untitled')} className="mb-4" />

      {info.message ? (
        <section aria-label={t('download.messageLabel')} className="bg-muted mb-4 p-4">
          <p className="text-sm break-words whitespace-pre-wrap">{info.message}</p>
        </section>
      ) : null}

      <dl className="mb-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">{t('download.contents')}</dt>
        <dd>
          {t('common.units.files', { count: files.length })} {'· '}
          <span className="font-mono">{formatBytes(info.totalBytes, locale)}</span>
        </dd>
        <dt className="text-muted-foreground">{t('download.availability')}</dt>
        <dd>
          {t('download.expires', {
            date: formatDateTime(info.expiresAt, locale),
            relative: formatRelative(info.expiresAt, locale),
          })}
        </dd>
        <dt className="text-muted-foreground">{t('download.counter')}</dt>
        <dd className="font-mono">
          {info.maxDownloads === null
            ? t('download.counterOnly', { count: info.downloadCount })
            : t('download.counterOf', { count: info.downloadCount, max: info.maxDownloads })}
        </dd>
      </dl>

      {remaining !== null && remaining <= LOW_DOWNLOADS_THRESHOLD ? (
        <Alert className="mb-4">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>
            {remaining <= 0
              ? t('download.limitNone')
              : remaining === 1
                ? t('download.limitLast')
                : t('download.limitSoon', { remaining })}
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="download-files-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="download-files-heading" className="text-lg font-semibold">
            {t('download.files.heading')}
          </h2>
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox
              id="download-select-all"
              checked={allSelected ? true : selectedIds.length > 0 ? 'indeterminate' : false}
              onCheckedChange={(checked) =>
                setSelected(checked === true ? new Set(files.map((file) => file.id)) : new Set())
              }
              className="mt-0"
            />
            <Label htmlFor="download-select-all" className="min-h-11 py-3 text-sm">
              {t('download.files.selectAll')}
            </Label>
          </div>
        </div>

        <ul className="divide-border border-border divide-y border">
          {files.map((file) => {
            const checkId = `download-file-${file.id}`;
            const size = formatBytes(file.sizeBytes, locale);
            return (
              <li
                key={file.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:flex-nowrap"
              >
                <Checkbox
                  id={checkId}
                  checked={selected.has(file.id)}
                  onCheckedChange={(checked) => toggle(file.id, checked === true)}
                  aria-label={t('download.files.selectFile', { name: file.name })}
                />
                <Label
                  htmlFor={checkId}
                  className="block min-h-11 min-w-0 flex-1 basis-40 py-2 text-sm leading-snug font-normal"
                  aria-hidden="true"
                >
                  <span className="block break-all">{file.name}</span>
                  <span className="text-muted-foreground block font-mono text-xs">{size}</span>
                </Label>
                <Button asChild variant="outline" onClick={started}>
                  <a
                    href={downloadFileUrl(token, file.id)}
                    download
                    aria-label={t('download.files.downloadNamed', { name: file.name, size })}
                  >
                    <Download aria-hidden="true" />
                    {t('download.files.download')}
                  </a>
                </Button>
              </li>
            );
          })}
        </ul>

        <p className="text-muted-foreground text-sm" aria-live="polite">
          {selectedIds.length > 0
            ? t('download.files.selectedCount', { count: selectedIds.length })
            : ''}
        </p>

        <div className="flex flex-wrap gap-3">
          <Button asChild onClick={started}>
            <a href={downloadZipUrl(token)} download>
              <FileArchive aria-hidden="true" />
              {t('download.zip.all')}
            </a>
          </Button>
          {selectedIds.length > 0 ? (
            <Button asChild variant="outline" onClick={started}>
              <a href={downloadZipUrl(token, selectedIds)} download>
                <FileArchive aria-hidden="true" />
                {t('download.zip.selected')}
              </a>
            </Button>
          ) : (
            <Button type="button" variant="outline" disabled aria-describedby={zipHint}>
              <FileArchive aria-hidden="true" />
              {t('download.zip.selected')}
            </Button>
          )}
        </div>
        {selectedIds.length === 0 ? (
          <p id={zipHint} className="text-muted-foreground text-sm">
            {t('download.zip.needSelection')}
          </p>
        ) : null}
      </section>

      <p className="text-muted-foreground mt-6 text-xs">{t('download.attachmentNote')}</p>
      <p role="status" className="text-sm font-medium">
        {announcement}
      </p>
    </PublicCard>
  );
}

export default function DownloadPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const timer = useRef<number | undefined>(undefined);

  const query = useQuery({
    queryKey: queryKeys.download(token),
    queryFn: ({ signal }) => getDownloadInfo(token, signal),
    enabled: token !== '',
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const refetch = () => queryClient.invalidateQueries({ queryKey: queryKeys.download(token) });
  const refetchSoon = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void refetch(), REFETCH_DELAY_MS);
  };

  if (query.isError) {
    return <ErrorView error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (!query.data) {
    return (
      <PublicCard width="default">
        <PageHeader title={t('download.title')} />
        <LoadingState label={t('download.loading')} variant="skeleton" />
      </PublicCard>
    );
  }
  if (query.data.locked) {
    return <UnlockView token={token} expiresAt={query.data.expiresAt} onUnlocked={refetch} />;
  }
  return <TransferView token={token} info={query.data} onDownloadStarted={refetchSoon} />;
}
