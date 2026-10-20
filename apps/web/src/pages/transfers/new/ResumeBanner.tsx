import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/app/query';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  clearDraft,
  matchPickedFiles,
  splitDraftFiles,
  type DraftRecord,
} from '@/features/upload/draft';
import type { UploadItem } from '@/features/upload/runner';
import { isApiError } from '@/lib/api/client';
import { deleteTransfer, getTransfer } from '@/lib/api/transfers';
import { formatBytes } from '@/lib/format';
import { notifyError, notifySuccess } from '@/lib/toast';
import { errorMessage } from '@/lib/errors';

interface ResumeBannerProps {
  draft: DraftRecord;
  /** The draft is gone (deleted, expired, already finalized): forget it. */
  onGone: () => void;
  onDiscarded: () => void;
  onResume: (draft: DraftRecord, items: UploadItem[]) => void;
}

/**
 * "An upload was interrupted": lists which files the server already has and asks to reselect the
 * missing ones (the browser cannot reopen files by itself). tus then continues from the stored
 * offset thanks to the draft-bound fingerprint.
 */
export function ResumeBanner({ draft, onGone, onDiscarded, onResume }: ResumeBannerProps) {
  const { t, i18n } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.transfers.detail(draft.transferId),
    queryFn: () => getTransfer(draft.transferId),
    retry: false,
  });

  const gone =
    (isApiError(query.error) && query.error.code === 'TRANSFER_NOT_FOUND') ||
    (query.data !== undefined && query.data.status !== 'uploading');
  useEffect(() => {
    if (gone) {
      clearDraft();
      onGone();
    }
  }, [gone, onGone]);

  const rows = useMemo(
    () =>
      query.data
        ? splitDraftFiles(
            draft.files,
            query.data.files.map((f) => ({ name: f.name, size: f.sizeBytes })),
          )
        : [],
    [draft.files, query.data],
  );
  const pending = rows.filter((row) => !row.done).map((row) => row.item);

  if (!query.data || gone) return null;

  const buildItems = (matches: (File | null)[]): UploadItem[] => {
    let next = 0;
    return rows.map((row) => ({
      name: row.item.name,
      size: row.item.size,
      file: row.done ? null : (matches[next++] ?? null),
    }));
  };

  const handlePicked = (picked: File[]) => {
    const { matches, missing: notFound } = matchPickedFiles(pending, picked);
    if (notFound.length > 0) {
      setMissing(notFound.map((f) => f.name));
      return;
    }
    setMissing([]);
    onResume(draft, buildItems(matches));
  };

  const discard = async () => {
    try {
      await deleteTransfer(draft.transferId);
    } catch (error) {
      if (!(isApiError(error) && error.code === 'TRANSFER_NOT_FOUND')) {
        notifyError(errorMessage(t, error));
        throw error;
      }
    }
    clearDraft();
    notifySuccess(t('transfers.resume.discarded'));
    onDiscarded();
  };

  return (
    <Alert className="mb-6" role="region" aria-labelledby="resume-title">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle id="resume-title">{t('transfers.resume.title')}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{t('transfers.resume.description')}</p>
        <ul className="space-y-1">
          {rows.map((row, index) => (
            <li key={`${index}-${row.item.name}`} className="flex items-start gap-2 text-sm">
              {row.done ? (
                <CheckCircle2 aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
              ) : (
                <CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              )}
              <span className="min-w-0 break-all">
                {row.item.name}{' '}
                <span className="text-muted-foreground font-mono text-xs">
                  {formatBytes(row.item.size, i18n.language)}
                </span>{' '}
                <span className="text-muted-foreground">
                  — {t(row.done ? 'transfers.resume.uploaded' : 'transfers.resume.toSelect')}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {missing.length > 0 ? (
          <p role="alert" className="text-destructive text-sm">
            {t('transfers.resume.missing', { files: missing.join(', ') })}
          </p>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          tabIndex={-1}
          data-testid="resume-input"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            handlePicked(files);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => (pending.length > 0 ? inputRef.current?.click() : handlePicked([]))}
          >
            {pending.length > 0
              ? t('transfers.resume.selectAndResume')
              : t('transfers.resume.resume')}
          </Button>
          <Button type="button" variant="outline" onClick={() => setConfirmDiscard(true)}>
            {t('transfers.resume.discard')}
          </Button>
        </div>
      </AlertDescription>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t('transfers.resume.discardTitle')}
        description={t('transfers.resume.discardDescription')}
        confirmLabel={t('transfers.resume.discard')}
        destructive
        onConfirm={discard}
      />
    </Alert>
  );
}
