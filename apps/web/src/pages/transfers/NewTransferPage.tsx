import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState, LoadingState } from '@/components/common/States';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { clearDraft, loadDraft, saveDraft, type DraftRecord } from '@/features/upload/draft';
import type { UploadItem } from '@/features/upload/runner';
import type { RunnerEvent } from '@/features/upload/types';
import { useUploadSession } from '@/features/upload/useUploadSession';
import { isApiError } from '@/lib/api/client';
import { getConfig, getMe } from '@/lib/api/me';
import { deleteTransfer } from '@/lib/api/transfers';
import { formatBytes } from '@/lib/format';
import { notifySuccess } from '@/lib/toast';
import { Dropzone } from './new/Dropzone';
import {
  DEFAULT_FORM_VALUES,
  createTransferResolver,
  toCreateRequest,
  type TransferFormValues,
} from './new/form';
import { OptionsFields, commitRecipientInput } from './new/OptionsFields';
import { ResumeBanner } from './new/ResumeBanner';
import { SelectedFiles } from './new/SelectedFiles';
import { SuccessPanel } from './new/SuccessPanel';
import { UploadProgressPanel } from './new/UploadProgressPanel';

const CHOOSE_BUTTON_ID = 'choose-files';
const FILE_KEY = (file: File) => `${file.name}\u0000${file.size}\u0000${file.lastModified}`;

export default function NewTransferPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: queryKeys.config, queryFn: getConfig, staleTime: 60_000 });
  const me = useQuery({ queryKey: queryKeys.me, queryFn: getMe });

  const [files, setFiles] = useState<File[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [fileNotice, setFileNotice] = useState('');
  const [draft, setDraft] = useState<DraftRecord | null>(() => loadDraft());
  const filesRef = useRef<File[]>(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const resolver = useMemo(() => createTransferResolver(t), [t]);
  const form = useForm<TransferFormValues>({
    resolver,
    defaultValues: DEFAULT_FORM_VALUES,
    reValidateMode: 'onChange',
  });

  const handleEvent = useCallback(
    (event: RunnerEvent) => {
      if (event.type === 'transfer' && loadDraft()?.transferId !== event.transferId) {
        const current = form.getValues();
        saveDraft({
          transferId: event.transferId,
          values: {
            mode: current.mode,
            title: current.title,
            message: current.message,
            recipients: current.mode === 'email' ? current.recipients : [],
            expiresIn: current.expiresIn,
            maxDownloads: current.maxDownloads,
          },
          files: filesRef.current.map((file) => ({
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
          })),
          createdAt: Date.now(),
        });
      }
      if (event.type === 'done') {
        clearDraft();
        void queryClient.invalidateQueries({ queryKey: queryKeys.transfers.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.me });
        notifySuccess(t('transfers.success.toast'));
      }
      if (
        event.type === 'error' &&
        isApiError(event.error) &&
        (event.error.code === 'TRANSFER_NOT_FOUND' ||
          event.error.code === 'TRANSFER_NOT_UPLOADABLE')
      ) {
        clearDraft();
      }
    },
    [form, queryClient, t],
  );

  const mode = useWatch({ control: form.control, name: 'mode' });

  const session = useUploadSession({ onEvent: handleEvent });
  const { state } = session;

  const maxFiles = config.data?.limits.maxFilesPerTransfer ?? 100;
  const maxNameLength = config.data?.limits.maxFilenameLength ?? 255;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const remaining =
    me.data && me.data.quotaBytes !== null
      ? Math.max(0, me.data.quotaBytes - me.data.usedBytes)
      : null;
  const overQuota = remaining !== null && total > remaining;

  const addFiles = (incoming: File[]) => {
    const known = new Set(files.map(FILE_KEY));
    const accepted: File[] = [];
    let duplicates = 0;
    let tooLong = 0;
    let overLimit = 0;
    for (const file of incoming) {
      if (known.has(FILE_KEY(file))) {
        duplicates += 1;
      } else if (file.name.length > maxNameLength) {
        tooLong += 1;
      } else if (files.length + accepted.length >= maxFiles) {
        overLimit += 1;
      } else {
        known.add(FILE_KEY(file));
        accepted.push(file);
      }
    }
    if (accepted.length > 0) setFiles([...files, ...accepted]);
    setFilesError(
      overLimit > 0
        ? t('transfers.new.errors.tooManyFiles', { max: maxFiles, count: overLimit })
        : tooLong > 0
          ? t('transfers.new.errors.nameTooLong', { max: maxNameLength, count: tooLong })
          : null,
    );
    const parts = [t('transfers.new.filesAdded', { count: accepted.length })];
    if (duplicates > 0) parts.push(t('transfers.new.duplicatesSkipped', { count: duplicates }));
    setFileNotice(parts.join(' '));
  };

  const removeFile = (index: number) => {
    const name = files[index]?.name ?? '';
    setFiles(files.filter((_, i) => i !== index));
    setFileNotice(t('transfers.new.fileRemoved', { name }));
    setFilesError(null);
  };

  const resetAll = () => {
    session.reset();
    form.reset(DEFAULT_FORM_VALUES);
    setFiles([]);
    setFilesError(null);
    setFileNotice('');
  };

  const submit = form.handleSubmit((values) => {
    if (!config.data) return;
    if (files.length === 0) {
      setFilesError(t('transfers.new.errors.noFiles'));
      document.getElementById(CHOOSE_BUTTON_ID)?.focus();
      return;
    }
    if (overQuota) return;
    // A previous interrupted draft is replaced: drop it from the server too (best effort).
    if (draft) {
      void deleteTransfer(draft.transferId).catch(() => undefined);
      clearDraft();
      setDraft(null);
    }
    setFilesError(null);
    session.start({
      create: toCreateRequest(values),
      files: files.map<UploadItem>((file) => ({ name: file.name, size: file.size, file })),
      chunkSize: config.data.chunkSizeBytes,
    });
  });

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Text typed in the recipients box counts as an added address.
    if (form.getValues('mode') === 'email' && !commitRecipientInput(form, t)) return;
    void submit(event);
  };

  const handleResume = (record: DraftRecord, items: UploadItem[]) => {
    if (!config.data) return;
    form.reset({ ...DEFAULT_FORM_VALUES, ...record.values, recipientInput: '' });
    setDraft(null);
    session.start({
      transferId: record.transferId,
      files: items,
      chunkSize: config.data.chunkSizeBytes,
    });
  };

  const handleCancel = async () => {
    clearDraft();
    await session.cancel();
  };

  const pageTitle = t('transfers.newTitle');
  const idle = state.phase === 'idle';

  if (config.isPending) {
    return (
      <>
        <PageHeader title={pageTitle} />
        <LoadingState />
      </>
    );
  }
  if (config.isError) {
    return (
      <>
        <PageHeader title={pageTitle} />
        <ErrorState error={config.error} onRetry={() => void config.refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={pageTitle}
        description={idle ? t('transfers.new.description') : undefined}
      />

      {state.phase === 'done' && state.result ? (
        <div className="max-w-3xl">
          <SuccessPanel transfer={state.result} onNew={resetAll} />
        </div>
      ) : !idle ? (
        <div className="max-w-3xl">
          <UploadProgressPanel
            state={state}
            onPause={session.pause}
            onResume={session.resume}
            onCancel={handleCancel}
            onRetry={session.retry}
            onBack={() => session.reset()}
          />
        </div>
      ) : (
        <>
          {draft ? (
            <ResumeBanner
              draft={draft}
              onGone={() => setDraft(null)}
              onDiscarded={() => setDraft(null)}
              onResume={handleResume}
            />
          ) : null}
          <form onSubmit={onSubmit} noValidate className="space-y-8">
            <FormErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />
            <div className="grid gap-8 lg:grid-cols-2">
              <section aria-labelledby="files-heading" className="space-y-4">
                <h2 id="files-heading" className="text-base font-semibold">
                  {t('transfers.new.filesHeading')}
                </h2>
                <Dropzone
                  onFiles={addFiles}
                  buttonId={CHOOSE_BUTTON_ID}
                  invalid={filesError !== null}
                  describedBy="files-limits"
                />
                <p id="files-limits" className="text-muted-foreground text-xs">
                  {t('transfers.new.limits', { max: maxFiles })}
                </p>
                {filesError ? (
                  <p role="alert" className="text-destructive text-sm">
                    {filesError}
                  </p>
                ) : null}
                <p role="status" aria-live="polite" className="sr-only">
                  {fileNotice}
                </p>
                <SelectedFiles files={files} onRemove={removeFile} />
              </section>

              <section aria-labelledby="options-heading" className="space-y-4">
                <h2 id="options-heading" className="text-base font-semibold">
                  {t('transfers.new.optionsHeading')}
                </h2>
                <OptionsFields form={form} config={config.data} />
              </section>
            </div>

            {me.data ? (
              <p className="text-muted-foreground text-sm">
                {me.data.quotaBytes === null
                  ? t('transfers.new.quotaUnlimited', {
                      used: formatBytes(me.data.usedBytes, i18n.language),
                    })
                  : t('transfers.new.quotaRemaining', {
                      remaining: formatBytes(remaining ?? 0, i18n.language),
                      quota: formatBytes(me.data.quotaBytes, i18n.language),
                    })}
              </p>
            ) : null}
            {overQuota ? (
              <Alert variant="destructive" role="alert">
                <AlertTriangle aria-hidden="true" />
                <AlertDescription>
                  {t('transfers.new.overQuota', {
                    total: formatBytes(total, i18n.language),
                    remaining: formatBytes(remaining ?? 0, i18n.language),
                  })}
                </AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" size="lg" disabled={overQuota}>
              {mode === 'email' ? t('transfers.new.submitEmail') : t('transfers.new.submitLink')}
            </Button>
          </form>
        </>
      )}
    </>
  );
}
