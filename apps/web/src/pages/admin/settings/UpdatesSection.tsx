import type { UpdateStatusResponse } from '@easysend/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpCircle,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  MinusCircle,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { CopyButton } from '@/components/common/CopyButton';
import { ErrorState, LoadingState } from '@/components/common/States';
import { Button } from '@/components/ui/button';
import { useUpdateStatus } from '@/hooks/use-update-status';
import { getUpdateStatus } from '@/lib/api/admin';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDateTime } from '@/lib/format';
import { notifyError } from '@/lib/toast';

/** Where the commands are run: the folder of the production install (see the deploy guide). */
const INSTALL_DIR = '/opt/easysend';

type StatusKey = 'upToDate' | 'available' | 'disabled' | 'unavailable';

const STATUS_ICON: Record<StatusKey, LucideIcon> = {
  upToDate: CheckCircle2,
  available: ArrowUpCircle,
  disabled: MinusCircle,
  unavailable: AlertTriangle,
};

function statusKey(data: UpdateStatusResponse): StatusKey {
  if (data.status === 'disabled') return 'disabled';
  if (data.status === 'unavailable') return 'unavailable';
  return data.updateAvailable ? 'available' : 'upToDate';
}

/** A plain `major.minor.patch` release number, the only kind the server compares. */
const isReleaseNumber = (version: string): boolean => /^v?\d+\.\d+\.\d+$/.test(version);

export function UpdatesSection() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const query = useUpdateStatus(true);

  const check = useMutation({
    mutationFn: () => getUpdateStatus(true),
    onSuccess: (response) => queryClient.setQueryData(queryKeys.admin.updates, response),
    onError: (error) => notifyError(errorMessage(t, error)),
  });

  if (query.isPending) return <LoadingState variant="skeleton" lines={3} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const data = query.data;
  const key = statusKey(data);
  const Icon = STATUS_ICON[key];
  const docsUrl = t('admin.settings.updates.docsUrl');
  const commands = data.latestVersion
    ? `cd ${INSTALL_DIR}\n./scripts/deploy.sh ${data.latestVersion}`
    : '';
  const checking = check.isPending;

  return (
    <div className="max-w-xl space-y-4">
      <dl className="ring-foreground/10 grid gap-x-6 gap-y-2 p-4 text-sm ring-1 sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">{t('admin.settings.updates.current')}</dt>
        <dd className="font-mono break-all">{data.currentVersion}</dd>
        {data.latestVersion ? (
          <>
            <dt className="text-muted-foreground">{t('admin.settings.updates.latest')}</dt>
            <dd className="font-mono break-all">{data.latestVersion}</dd>
          </>
        ) : null}
        {data.publishedAt ? (
          <>
            <dt className="text-muted-foreground">{t('admin.settings.updates.published')}</dt>
            <dd>{formatDate(data.publishedAt, i18n.language)}</dd>
          </>
        ) : null}
        {data.checkedAt ? (
          <>
            <dt className="text-muted-foreground">{t('admin.settings.updates.checked')}</dt>
            <dd>{formatDateTime(data.checkedAt, i18n.language)}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">{t('admin.settings.updates.status')}</dt>
        <dd>
          {/* The live region is inside the <dd>: a role on the <dd> itself breaks the <dl> structure. */}
          <span role="status" className="flex items-center gap-1.5 font-medium">
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            {t(`admin.settings.updates.${key}`)}
          </span>
        </dd>
      </dl>

      {key === 'disabled' ? (
        <p className="text-muted-foreground text-sm">{t('admin.settings.updates.disabledHint')}</p>
      ) : null}
      {key === 'unavailable' ? (
        <p className="text-muted-foreground text-sm">
          {t('admin.settings.updates.unavailableHint')}
        </p>
      ) : null}
      {data.status === 'ok' && !isReleaseNumber(data.currentVersion) ? (
        <p className="text-muted-foreground text-sm">
          {t('admin.settings.updates.devBuild', { version: data.currentVersion })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          type="button"
          variant="outline"
          disabled={checking || !data.enabled}
          aria-busy={checking}
          onClick={() => check.mutate()}
        >
          <RefreshCw aria-hidden="true" className={checking ? 'animate-spin' : undefined} />
          {checking ? t('admin.settings.updates.checking') : t('admin.settings.updates.checkNow')}
        </Button>
        {data.releaseUrl ? (
          <a
            href={data.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm underline underline-offset-4"
          >
            {t('admin.settings.updates.releaseNotes')}
            <ExternalLink aria-hidden="true" className="size-4" />
            <span className="sr-only">{t('admin.settings.updates.newTab')}</span>
          </a>
        ) : null}
      </div>

      {data.updateAvailable && data.latestVersion ? (
        <div className="ring-foreground/10 space-y-3 p-4 ring-1">
          <h3 className="font-medium">{t('admin.settings.updates.howTitle')}</h3>
          <p className="text-muted-foreground text-sm">{t('admin.settings.updates.howBody')}</p>
          <pre
            role="group"
            aria-label={t('admin.settings.updates.commands')}
            className="bg-muted p-3 font-mono text-sm break-words whitespace-pre-wrap"
          >
            <code>{commands}</code>
          </pre>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <CopyButton value={commands} />
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 text-sm underline underline-offset-4"
            >
              <BookOpen aria-hidden="true" className="size-4" />
              {t('admin.settings.updates.docs')}
              <ExternalLink aria-hidden="true" className="size-4" />
              <span className="sr-only">{t('admin.settings.updates.newTab')}</span>
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
