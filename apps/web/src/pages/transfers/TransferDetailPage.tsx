import type { TransferDetail } from '@easysend/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Mail, Pencil, Trash2, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useSession } from '@/app/providers/SessionProvider';
import { queryKeys } from '@/app/query';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { CopyButton } from '@/components/common/CopyButton';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isApiError } from '@/lib/api/client';
import {
  deleteTransfer,
  deleteTransferFile,
  getTransfer,
  resendTransfer,
  revokeTransfer,
} from '@/lib/api/transfers';
import { errorMessage } from '@/lib/errors';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import { notifyError, notifySuccess } from '@/lib/toast';
import { DownloadLog } from './detail/DownloadLog';
import { EditTransferDialog } from './detail/EditTransferDialog';
import { downloadsText, transferTitle } from './list-utils';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function TransferDetailPage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const { user, isAdmin } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'revoke' | 'delete' | null>(null);
  const [fileToDelete, setFileToDelete] = useState<TransferDetail['files'][number] | null>(null);
  const [resending, setResending] = useState(false);
  const locale = i18n.language;

  const query = useQuery({
    queryKey: queryKeys.transfers.detail(id),
    queryFn: () => getTransfer(id),
    // A draft keeps changing while its files are being encrypted.
    refetchInterval: (q) => (q.state.data?.status === 'uploading' ? 5000 : false),
  });

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.transfers.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  };

  if (query.isPending) {
    return (
      <>
        <PageHeader title={t('transfers.detailTitle')} />
        <LoadingState variant="skeleton" lines={6} />
      </>
    );
  }
  if (query.isError) {
    const notFound = isApiError(query.error) && query.error.code === 'TRANSFER_NOT_FOUND';
    return (
      <>
        <PageHeader
          title={notFound ? t('transfers.detail.notFoundTitle') : t('transfers.detailTitle')}
        />
        {notFound ? (
          <EmptyState
            title={t('transfers.detail.notFoundTitle')}
            description={t('errors.TRANSFER_NOT_FOUND')}
            action={
              <Button asChild variant="outline">
                <Link to="/transfers">{t('transfers.detail.backToList')}</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </>
    );
  }

  const transfer = query.data;
  const isDraft = transfer.status === 'uploading';
  const isActive = transfer.status === 'active';
  const showOwner = isAdmin && user !== null && transfer.ownerId !== user.id;

  const setDetail = (updated: TransferDetail) => {
    queryClient.setQueryData(queryKeys.transfers.detail(id), updated);
    refreshLists();
  };

  const revoke = async () => {
    try {
      setDetail(await revokeTransfer(id));
      notifySuccess(t('transfers.detail.revoked'));
    } catch (error) {
      notifyError(errorMessage(t, error));
      throw error;
    }
  };

  const remove = async () => {
    try {
      await deleteTransfer(id);
    } catch (error) {
      notifyError(errorMessage(t, error));
      throw error;
    }
    queryClient.removeQueries({ queryKey: queryKeys.transfers.detail(id) });
    refreshLists();
    notifySuccess(t(isDraft ? 'transfers.detail.draftDeleted' : 'transfers.detail.deleted'));
    void navigate('/transfers');
  };

  const removeFile = async () => {
    if (!fileToDelete) return;
    try {
      await deleteTransferFile(id, fileToDelete.id);
    } catch (error) {
      notifyError(errorMessage(t, error));
      throw error;
    }
    notifySuccess(t('transfers.detail.fileDeleted'));
    await queryClient.invalidateQueries({ queryKey: queryKeys.transfers.detail(id) });
    refreshLists();
  };

  const resend = async () => {
    setResending(true);
    try {
      setDetail(await resendTransfer(id));
      notifySuccess(t('transfers.detail.resent'));
    } catch (error) {
      notifyError(errorMessage(t, error));
    } finally {
      setResending(false);
    }
  };

  const title = transferTitle(transfer, t('transfers.list.untitled'));

  const actions = (
    <>
      {isDraft ? (
        <Button asChild>
          <Link to="/">
            <Upload aria-hidden="true" />
            {t('transfers.detail.resumeUpload')}
          </Link>
        </Button>
      ) : null}
      {isActive ? (
        <Button type="button" variant="outline" onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" />
          {t('common.actions.edit')}
        </Button>
      ) : null}
      {isActive && transfer.mode === 'email' ? (
        <Button type="button" variant="outline" disabled={resending} onClick={() => void resend()}>
          <Mail aria-hidden="true" />
          {resending ? t('common.actions.working') : t('transfers.detail.resend')}
        </Button>
      ) : null}
      {isActive ? (
        <Button type="button" variant="outline" onClick={() => setConfirm('revoke')}>
          <Ban aria-hidden="true" />
          {t('common.actions.revoke')}
        </Button>
      ) : null}
      <Button type="button" variant="destructive" onClick={() => setConfirm('delete')}>
        <Trash2 aria-hidden="true" />
        {t('common.actions.delete')}
      </Button>
    </>
  );

  return (
    <>
      <PageHeader title={title} actions={actions} />
      <div className="max-w-4xl space-y-8">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={transfer.status} />
          <Button asChild variant="link" className="px-0">
            <Link to="/transfers">{t('transfers.detail.backToList')}</Link>
          </Button>
        </div>

        {isDraft ? (
          <p className="border-border border p-4 text-sm">{t('transfers.detail.draftNotice')}</p>
        ) : null}

        {isActive && transfer.shareUrl ? (
          <Section id="share-heading" title={t('transfers.detail.shareLink')}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                readOnly
                aria-labelledby="share-heading"
                value={transfer.shareUrl}
                className="font-mono"
                onFocus={(event) => event.currentTarget.select()}
              />
              <CopyButton value={transfer.shareUrl}>{t('transfers.success.copyLink')}</CopyButton>
            </div>
          </Section>
        ) : null}

        <Section id="facts-heading" title={t('transfers.detail.details')}>
          <dl className="border-border grid gap-x-6 gap-y-4 border p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('transfers.detail.mode')}>{t(`transfers.mode.${transfer.mode}`)}</Fact>
            <Fact label={t('transfers.detail.created')}>
              {formatDateTime(transfer.createdAt, locale)}
            </Fact>
            {!isDraft ? (
              <Fact label={t('transfers.detail.expires')}>
                <time
                  dateTime={new Date(transfer.expiresAt * 1000).toISOString()}
                  title={formatRelative(transfer.expiresAt, locale)}
                >
                  {formatDateTime(transfer.expiresAt, locale)}
                </time>{' '}
                <span className="text-muted-foreground">
                  ({formatRelative(transfer.expiresAt, locale)})
                </span>
              </Fact>
            ) : null}
            <Fact label={t('transfers.detail.size')}>
              <span className="font-mono">{formatBytes(transfer.totalBytes, locale)}</span> ·{' '}
              {t('common.units.files', { count: transfer.fileCount })}
            </Fact>
            <Fact label={t('transfers.detail.downloads')}>
              <span className="font-mono">{downloadsText(transfer)}</span>
              {transfer.maxDownloads === null ? (
                <span className="text-muted-foreground"> ({t('transfers.detail.unlimited')})</span>
              ) : null}
            </Fact>
            <Fact label={t('transfers.detail.password')}>
              {transfer.hasPassword
                ? t('transfers.detail.passwordSet')
                : t('transfers.detail.passwordNone')}
            </Fact>
            <Fact label={t('transfers.detail.firstDownload')}>
              {transfer.firstDownloadedAt
                ? formatDateTime(transfer.firstDownloadedAt, locale)
                : t('transfers.detail.never')}
            </Fact>
            {showOwner ? (
              <Fact label={t('transfers.detail.owner')}>{transfer.ownerEmail}</Fact>
            ) : null}
          </dl>
        </Section>

        {transfer.message ? (
          <Section id="message-heading" title={t('transfers.detail.message')}>
            <p className="border-border border p-4 text-sm break-words whitespace-pre-wrap">
              {transfer.message}
            </p>
          </Section>
        ) : null}

        <Section id="files-heading" title={t('transfers.detail.files')}>
          {transfer.files.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('transfers.detail.noFiles')}</p>
          ) : (
            <ul className="divide-border border-border divide-y border">
              {transfer.files.map((file) => (
                <li key={file.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 pl-3">
                  <span className="min-w-0 flex-1 basis-48 text-sm break-all">{file.name}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {formatBytes(file.sizeBytes, locale)}
                  </span>
                  <span className="flex items-center">
                    <code className="text-muted-foreground font-mono text-xs" title={file.sha256}>
                      SHA-256 {file.sha256.slice(0, 12)}…
                    </code>
                    <CopyButton
                      value={file.sha256}
                      variant="ghost"
                      size="icon"
                      aria-label={t('transfers.detail.copyHash', { name: file.name })}
                    >
                      <span className="sr-only">{t('common.actions.copy')}</span>
                    </CopyButton>
                  </span>
                  {isDraft ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('transfers.detail.deleteFile', { name: file.name })}
                      onClick={() => setFileToDelete(file)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : (
                    <span className="w-2" />
                  )}
                </li>
              ))}
            </ul>
          )}
          {isDraft && transfer.uploads.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">{t('transfers.detail.uploads')}</h3>
              <ul className="divide-border border-border divide-y border">
                {transfer.uploads.map((upload) => (
                  <li
                    key={upload.id}
                    className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 break-all">{upload.fileName}</span>
                    <span className="text-muted-foreground">
                      <span className="font-mono text-xs">
                        {formatBytes(upload.totalSize, locale)}
                      </span>{' '}
                      · {t(`transfers.detail.uploadStatus.${upload.status}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>

        {transfer.mode === 'email' ? (
          <Section id="recipients-heading" title={t('transfers.detail.recipients')}>
            {transfer.recipients.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('transfers.detail.noRecipients')}</p>
            ) : (
              <ul className="divide-border border-border divide-y border">
                {transfer.recipients.map((recipient) => (
                  <li
                    key={recipient.email}
                    className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 break-all">{recipient.email}</span>
                    <span className="text-muted-foreground">
                      {recipient.notifiedAt
                        ? t('transfers.detail.notified', {
                            date: formatDateTime(recipient.notifiedAt, locale),
                          })
                        : t('transfers.detail.notNotified')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}

        {!isDraft ? (
          <Section id="log-heading" title={t('transfers.detail.downloadLog')}>
            <DownloadLog transferId={transfer.id} />
          </Section>
        ) : null}
      </div>

      {isActive ? (
        <EditTransferDialog transfer={transfer} open={editing} onOpenChange={setEditing} />
      ) : null}

      <ConfirmDialog
        open={confirm === 'revoke'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('transfers.detail.revokeTitle')}
        description={t('transfers.detail.revokeDescription')}
        confirmLabel={t('common.actions.revoke')}
        destructive
        onConfirm={revoke}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t(isDraft ? 'transfers.detail.deleteDraftTitle' : 'transfers.detail.deleteTitle')}
        description={t(
          isDraft
            ? 'transfers.detail.deleteDraftDescription'
            : 'transfers.detail.deleteDescription',
        )}
        confirmLabel={t('common.actions.delete')}
        destructive
        onConfirm={remove}
      />
      <ConfirmDialog
        open={fileToDelete !== null}
        onOpenChange={(open) => !open && setFileToDelete(null)}
        title={t('transfers.detail.deleteFileTitle')}
        description={t('transfers.detail.deleteFileDescription', {
          name: fileToDelete?.name ?? '',
        })}
        confirmLabel={t('common.actions.delete')}
        destructive
        onConfirm={removeFile}
      />
    </>
  );
}
