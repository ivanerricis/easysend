import {
  EMAIL_MAX_LENGTH,
  FILENAME_MAX_LENGTH,
  MESSAGE_MAX_LENGTH,
  SENDER_NAME_MAX_LENGTH,
  emailSchema,
  type CreateSubmissionRequest,
  type RequestInfoResponse,
} from '@easysend/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { queryKeys } from '@/app/query';
import { FormErrorSummary } from '@/components/common/FormErrorSummary';
import { FormField, TextField } from '@/components/common/FormField';
import { PageHeader } from '@/components/common/PageHeader';
import { PublicCard } from '@/components/layout/PublicLayout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { pickedKey, topFolder } from '@/features/upload/folders';
import type { UploadItem } from '@/features/upload/runner';
import {
  clearSubmissionDraft,
  createSubmissionDeps,
  loadSubmissionDraft,
  saveSubmissionDraft,
  type SubmissionDraft,
} from '@/features/upload/submission';
import type { PickedFile, RunnerEvent } from '@/features/upload/types';
import { useUploadSession } from '@/features/upload/useUploadSession';
import { isApiError } from '@/lib/api/client';
import { cancelSubmission, getSubmission } from '@/lib/api/submissions';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import { Dropzone } from '@/pages/transfers/new/Dropzone';
import { ResumeBanner } from '@/pages/transfers/new/ResumeBanner';
import { SelectedFiles } from '@/pages/transfers/new/SelectedFiles';
import { UploadProgressPanel } from '@/pages/transfers/new/UploadProgressPanel';

type OpenRequest = Extract<RequestInfoResponse, { locked: false }>;

interface SubmitFormValues {
  name: string;
  email: string;
  message: string;
}

const CHOOSE_BUTTON_ID = 'submit-choose-files';

/** Errors that replace the whole page (the link is not usable any more). */
const PAGE_LEVEL_CODES = new Set([
  'REQUEST_NOT_FOUND',
  'REQUEST_EXPIRED',
  'REQUEST_REVOKED',
  'REQUEST_FULL',
]);
/** Errors that mean the stored draft can never be resumed. */
const DRAFT_GONE_CODES = new Set(['TRANSFER_NOT_FOUND', 'TRANSFER_NOT_UPLOADABLE']);

function createFormSchema(info: OpenRequest, t: TFunction) {
  const optionalText = (max: number, message: string) => z.string().trim().max(max, message);
  return z.object({
    name: info.requireName
      ? z
          .string()
          .trim()
          .min(1, t('submit.form.errors.nameRequired'))
          .max(
            SENDER_NAME_MAX_LENGTH,
            t('submit.form.errors.nameLength', { max: SENDER_NAME_MAX_LENGTH }),
          )
      : optionalText(
          SENDER_NAME_MAX_LENGTH,
          t('submit.form.errors.nameLength', { max: SENDER_NAME_MAX_LENGTH }),
        ),
    email: z
      .string()
      .trim()
      .max(EMAIL_MAX_LENGTH, t('submit.form.errors.emailInvalid'))
      .superRefine((value, ctx) => {
        if (value === '') {
          if (info.requireEmail) {
            ctx.addIssue({ code: 'custom', message: t('submit.form.errors.emailRequired') });
          }
        } else if (!emailSchema.safeParse(value).success) {
          ctx.addIssue({ code: 'custom', message: t('submit.form.errors.emailInvalid') });
        }
      }),
    message: z
      .string()
      .max(MESSAGE_MAX_LENGTH, t('submit.form.errors.messageLength', { max: MESSAGE_MAX_LENGTH })),
  });
}

/** Body of `submissions.create`: empty optional fields are left out. */
function toSubmissionRequest(values: SubmitFormValues): CreateSubmissionRequest {
  const body: CreateSubmissionRequest = {};
  if (values.name.trim()) body.name = values.name.trim();
  if (values.email.trim()) body.email = values.email.trim();
  if (values.message.trim()) body.message = values.message;
  return body;
}

interface SubmitViewProps {
  token: string;
  info: OpenRequest;
}

/** The open upload request: form, upload progress and the final confirmation. */
export function SubmitView({ token, info }: SubmitViewProps) {
  const { t, i18n } = useTranslation();
  const { instanceName } = useAppearance();
  const queryClient = useQueryClient();
  const locale = i18n.language;

  const [files, setFiles] = useState<PickedFile[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [fileNotice, setFileNotice] = useState('');
  const [draft, setDraft] = useState<SubmissionDraft | null>(() => loadSubmissionDraft(token));
  const filesRef = useRef<PickedFile[]>(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const schema = useMemo(() => createFormSchema(info, t), [info, t]);
  const form = useForm<SubmitFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', message: '' },
    reValidateMode: 'onChange',
  });

  // The submission token returned by `create` (or restored from a stored draft).
  const [{ deps, tokenRef }] = useState(() => createSubmissionDeps(token));

  const refreshInfo = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.submitRequest(token) });

  const handleEvent = (event: RunnerEvent) => {
    if (event.type === 'transfer' && tokenRef.current) {
      // Keep what is needed to resume after a refresh (never the form values).
      const stored = loadSubmissionDraft(token);
      if (stored?.transferId !== event.transferId) {
        saveSubmissionDraft(token, {
          ...tokenRef.current,
          files: filesRef.current.map(({ file, path }) => ({
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
            path,
          })),
          createdAt: Date.now(),
        });
      }
    }
    if (event.type === 'done') {
      clearSubmissionDraft(token);
      tokenRef.current = null;
      void refreshInfo();
    }
    if (event.type === 'error' && isApiError(event.error)) {
      if (DRAFT_GONE_CODES.has(event.error.code)) clearSubmissionDraft(token);
      if (PAGE_LEVEL_CODES.has(event.error.code)) {
        clearSubmissionDraft(token);
        void refreshInfo(); // the info query answers the same error and the page shows it
      }
    }
  };

  const session = useUploadSession<CreateSubmissionRequest>({ onEvent: handleEvent, deps });
  const { state } = session;
  const idle = state.phase === 'idle';

  const total = files.reduce((sum, picked) => sum + picked.file.size, 0);
  const remaining = info.remainingBytes;
  const overLimit = remaining !== null && total > remaining;

  const addFiles = (incoming: PickedFile[]) => {
    const known = new Set(files.map(pickedKey));
    const accepted: PickedFile[] = [];
    let duplicates = 0;
    let tooLong = 0;
    let tooMany = 0;
    for (const picked of incoming) {
      const { file } = picked;
      if (known.has(pickedKey(picked))) duplicates += 1;
      else if (file.name.length > FILENAME_MAX_LENGTH) tooLong += 1;
      else if (files.length + accepted.length >= info.maxFilesPerTransfer) tooMany += 1;
      else {
        known.add(pickedKey(picked));
        accepted.push(picked);
      }
    }
    if (accepted.length > 0) setFiles([...files, ...accepted]);
    setFilesError(
      tooMany > 0
        ? t('submit.form.errors.tooManyFiles', { max: info.maxFilesPerTransfer, count: tooMany })
        : tooLong > 0
          ? t('submit.form.errors.nameTooLong', { max: FILENAME_MAX_LENGTH, count: tooLong })
          : null,
    );
    const parts = [t('transfers.new.filesAdded', { count: accepted.length })];
    if (duplicates > 0) parts.push(t('transfers.new.duplicatesSkipped', { count: duplicates }));
    setFileNotice(parts.join(' '));
  };

  const removeFile = (index: number) => {
    const name = files[index]?.file.name ?? '';
    setFiles(files.filter((_, i) => i !== index));
    setFileNotice(t('transfers.new.fileRemoved', { name }));
    setFilesError(null);
  };

  const removeFolder = (folder: string) => {
    setFiles(files.filter((picked) => topFolder(picked.path) !== folder));
    setFileNotice(t('transfers.new.folderRemoved', { name: folder }));
    setFilesError(null);
  };

  const resetAll = () => {
    session.reset();
    tokenRef.current = null;
    form.reset({ name: '', email: '', message: '' });
    setFiles([]);
    setFilesError(null);
    setFileNotice('');
  };

  const submit = form.handleSubmit((values) => {
    if (files.length === 0) {
      setFilesError(t('submit.form.errors.noFiles'));
      document.getElementById(CHOOSE_BUTTON_ID)?.focus();
      return;
    }
    if (overLimit) return;
    // A previous interrupted submission is replaced: cancel it on the server too (best effort).
    if (draft) {
      void cancelSubmission(token, draft.transferId, draft.submissionToken).catch(() => undefined);
      clearSubmissionDraft(token);
      setDraft(null);
    }
    setFilesError(null);
    session.start({
      create: toSubmissionRequest(values),
      files: files.map<UploadItem>(({ file, path }) => ({
        name: file.name,
        size: file.size,
        path,
        file,
      })),
      chunkSize: info.chunkSizeBytes,
    });
  });

  const handleResume = (record: SubmissionDraft, items: UploadItem[]) => {
    tokenRef.current = {
      transferId: record.transferId,
      submissionToken: record.submissionToken,
      submissionTokenExpiresAt: record.submissionTokenExpiresAt,
    };
    setDraft(null);
    session.start({
      transferId: record.transferId,
      files: items,
      chunkSize: info.chunkSizeBytes,
    });
  };

  const handleCancel = async () => {
    clearSubmissionDraft(token);
    await session.cancel();
    tokenRef.current = null;
  };

  const sender = info.ownerName ?? instanceName;
  const result =
    state.phase === 'done' && state.result && 'fileCount' in state.result ? state.result : null;

  return (
    <PublicCard width="wide">
      <p className="text-muted-foreground mb-2 text-sm">{t('submit.askedBy', { name: sender })}</p>
      <PageHeader title={info.title} className="mb-4" />

      {result ? (
        <SuccessView
          fileCount={result.fileCount}
          totalBytes={result.totalBytes}
          onMore={resetAll}
        />
      ) : !idle ? (
        <UploadProgressPanel
          state={state}
          onPause={session.pause}
          onResume={session.resume}
          onCancel={handleCancel}
          onRetry={session.retry}
          onBack={() => session.reset()}
          focusOnMount
        />
      ) : (
        <>
          {info.message ? (
            <section aria-label={t('submit.instructionsLabel')} className="bg-muted mb-4 p-4">
              <p className="text-sm break-words whitespace-pre-wrap">{info.message}</p>
            </section>
          ) : null}

          <dl className="mb-6 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{t('submit.remaining')}</dt>
            <dd className="font-mono">
              {remaining === null ? t('submit.unlimited') : formatBytes(remaining, locale)}
            </dd>
            <dt className="text-muted-foreground">{t('download.availability')}</dt>
            <dd>
              {t('submit.expires', {
                date: formatDateTime(info.expiresAt, locale),
                relative: formatRelative(info.expiresAt, locale),
              })}
            </dd>
          </dl>

          {draft ? (
            <ResumeBanner
              draft={draft}
              queryKey={queryKeys.submission(token, draft.transferId)}
              load={() => getSubmission(token, draft.transferId, draft.submissionToken)}
              remove={() => cancelSubmission(token, draft.transferId, draft.submissionToken)}
              onForget={() => clearSubmissionDraft(token)}
              onGone={() => setDraft(null)}
              onDiscarded={() => setDraft(null)}
              onResume={handleResume}
              title={t('submit.resume.title')}
              description={t('submit.resume.description')}
            />
          ) : null}

          <form onSubmit={(event) => void submit(event)} noValidate className="space-y-6">
            <FormErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />

            <fieldset className="space-y-4">
              <legend className="mb-2 text-base font-semibold">
                {t('submit.form.yourDetails')}
              </legend>
              <TextField
                control={form.control}
                name="name"
                label={t('submit.form.name')}
                optional={!info.requireName}
                autoComplete="name"
                maxLength={SENDER_NAME_MAX_LENGTH}
              />
              <TextField
                control={form.control}
                name="email"
                type="email"
                label={t('submit.form.email')}
                optional={!info.requireEmail}
                autoComplete="email"
                maxLength={EMAIL_MAX_LENGTH}
              />
              <FormField
                control={form.control}
                name="message"
                label={t('submit.form.message')}
                description={t('submit.form.messageHint')}
                optional
              >
                {({ field, controlProps }) => <Textarea rows={3} {...field} {...controlProps} />}
              </FormField>
            </fieldset>

            <section aria-labelledby="submit-files-heading" className="space-y-4">
              <h2 id="submit-files-heading" className="text-base font-semibold">
                {t('submit.form.filesHeading')}
              </h2>
              <Dropzone
                onFiles={addFiles}
                buttonId={CHOOSE_BUTTON_ID}
                invalid={filesError !== null}
                describedBy="submit-files-limits"
              />
              <p id="submit-files-limits" className="text-muted-foreground text-xs">
                {t('submit.form.limits', { max: info.maxFilesPerTransfer })}
                {remaining !== null
                  ? ` ${t('submit.form.spaceLeft', { size: formatBytes(remaining, locale) })}`
                  : ''}
              </p>
              {filesError ? (
                <p role="alert" className="text-destructive text-sm">
                  {filesError}
                </p>
              ) : null}
              <p role="status" aria-live="polite" className="sr-only">
                {fileNotice}
              </p>
              <SelectedFiles files={files} onRemove={removeFile} onRemoveFolder={removeFolder} />
              {overLimit ? (
                <Alert variant="destructive" role="alert">
                  <AlertTriangle aria-hidden="true" />
                  <AlertDescription>
                    {t('submit.form.errors.overLimit', {
                      total: formatBytes(total, locale),
                      remaining: formatBytes(remaining ?? 0, locale),
                    })}
                  </AlertDescription>
                </Alert>
              ) : null}
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" disabled={overLimit} className="w-full sm:w-auto">
                {t('submit.form.submit')}
              </Button>
              {files.length > 0 ? (
                <p className="text-sm tabular-nums" data-testid="submit-total">
                  {t('common.units.files', { count: files.length })} {'· '}
                  {formatBytes(total, locale)}
                </p>
              ) : null}
            </div>
          </form>
        </>
      )}
    </PublicCard>
  );
}

function SuccessView({
  fileCount,
  totalBytes,
  onMore,
}: {
  fileCount: number;
  totalBytes: number;
  onMore: () => void;
}) {
  const { t, i18n } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section aria-labelledby="submit-success-heading" className="space-y-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 aria-hidden="true" className="text-primary size-6 shrink-0" />
        <h2
          id="submit-success-heading"
          ref={heading}
          tabIndex={-1}
          className="text-xl font-semibold outline-none"
        >
          {t('submit.success.title')}
        </h2>
      </div>
      <p className="text-sm">
        {t('submit.success.description', {
          files: t('common.units.files', { count: fileCount }),
          size: formatBytes(totalBytes, i18n.language),
        })}
      </p>
      <Button type="button" onClick={onMore}>
        {t('submit.success.more')}
      </Button>
    </section>
  );
}
