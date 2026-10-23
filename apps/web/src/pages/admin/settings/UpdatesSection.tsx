import type { UpdateStatusResponse } from '@easysend/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { SelectInput } from '@/components/common/SelectInput';
import { ErrorState, LoadingState } from '@/components/common/States';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useUpdateRun } from '@/hooks/use-update-run';
import { useUpdateStatus } from '@/hooks/use-update-status';
import { getUpdateStatus, startUpdate } from '@/lib/api/admin';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDateTime } from '@/lib/format';
import { notifyError } from '@/lib/toast';
import { CommandBlock, INSTALL_DIR, UpdateOutcome, UpdateProgress } from './UpdateRunPanel';

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
  const run = useUpdateRun(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const runState = run.data?.run;

  // The running version changes when an update succeeds: read the status again once.
  const succeededId = runState?.state === 'succeeded' ? runState.id : null;
  useEffect(() => {
    if (succeededId) void queryClient.invalidateQueries({ queryKey: queryKeys.admin.updates });
  }, [succeededId, queryClient]);

  const start = useMutation({
    mutationFn: (version: string) => startUpdate(version),
    onSuccess: (response) =>
      queryClient.setQueryData(queryKeys.admin.updateRun, {
        runner: 'installed',
        pending: {
          id: response.id,
          version: response.version,
          requestedAt: response.requestedAt,
          stale: false,
        },
        run: run.data?.run ?? null,
      }),
    onError: (error) => {
      notifyError(errorMessage(t, error));
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.updateRun });
    },
  });

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
  const runner = run.data?.runner;
  const versions = data.enabled ? data.availableVersions : [];
  const chosen = versions.find((item) => item.version === selected) ?? versions[0];
  const canStart = runner === 'installed' && !run.active && chosen !== undefined;
  const showManual =
    data.updateAvailable && data.latestVersion && !(runner === 'installed' && versions.length > 0);
  const outcome = !run.active && runState && runState.state !== 'running' ? runState : null;

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

      {run.data && run.active ? (
        <UpdateProgress
          data={run.data}
          restarting={run.restarting}
          signedOut={run.signedOut}
          requesting={start.isPending}
          onRequestAgain={(version) => start.mutate(version)}
        />
      ) : null}

      {outcome ? <UpdateOutcome run={outcome} /> : null}

      {canStart && chosen ? (
        <div className="ring-foreground/10 space-y-3 p-4 ring-1">
          <div className="space-y-2">
            <Label htmlFor="update-version">
              {t('admin.settings.updates.oneClick.versionLabel')}
            </Label>
            <SelectInput
              id="update-version"
              value={chosen.version}
              onValueChange={setSelected}
              options={versions.map((item) => ({
                value: item.version,
                label: item.publishedAt
                  ? t('admin.settings.updates.oneClick.versionOption', {
                      version: item.version,
                      date: formatDate(item.publishedAt, i18n.language),
                    })
                  : t('admin.settings.updates.oneClick.versionOptionNoDate', {
                      version: item.version,
                    }),
              }))}
            />
          </div>
          <Button type="button" onClick={() => setConfirming(true)}>
            <ArrowUpCircle aria-hidden="true" />
            {t('admin.settings.updates.oneClick.start')}
          </Button>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={t('admin.settings.updates.oneClick.confirmTitle', {
              from: data.currentVersion,
              to: chosen.version,
            })}
            description={
              <>
                <span className="block">{t('admin.settings.updates.oneClick.confirmBody')}</span>
                <a
                  href={chosen.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-1.5 underline underline-offset-4"
                >
                  {t('admin.settings.updates.oneClick.notesLink', { version: chosen.version })}
                  <ExternalLink aria-hidden="true" className="size-4" />
                  <span className="sr-only">{t('admin.settings.updates.newTab')}</span>
                </a>
              </>
            }
            confirmLabel={t('admin.settings.updates.oneClick.confirm')}
            onConfirm={() => start.mutateAsync(chosen.version).catch(() => undefined)}
          />
        </div>
      ) : null}

      {runner === 'missing' ? (
        <div className="ring-foreground/10 space-y-3 p-4 ring-1">
          <h3 className="font-medium">{t('admin.settings.updates.oneClick.missingTitle')}</h3>
          <p className="text-muted-foreground text-sm">
            {t('admin.settings.updates.oneClick.missingBody')}
          </p>
          <CommandBlock
            label={t('admin.settings.updates.oneClick.installCommands')}
            value={`cd ${INSTALL_DIR}
sudo ./scripts/update-service.sh install`}
          />
          <a
            href={t('admin.settings.updates.oneClick.docsOneClickUrl')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm underline underline-offset-4"
          >
            <BookOpen aria-hidden="true" className="size-4" />
            {t('admin.settings.updates.oneClick.docsOneClick')}
            <ExternalLink aria-hidden="true" className="size-4" />
            <span className="sr-only">{t('admin.settings.updates.newTab')}</span>
          </a>
        </div>
      ) : null}

      {showManual && !run.active ? (
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
