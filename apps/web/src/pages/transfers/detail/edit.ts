import {
  LINK_PASSWORD_MIN_LENGTH,
  MAX_DOWNLOADS_LIMIT,
  MESSAGE_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  updateTransferRequestSchema,
  type ExpiryKey,
  type TransferDetail,
  type UpdateTransferRequest,
} from '@easysend/shared';
import type { TFunction } from 'i18next';
import type { FieldErrors, Resolver, ResolverResult } from 'react-hook-form';

export interface EditFormValues {
  title: string;
  message: string;
  /** `keep` leaves the expiry alone; a key restarts the countdown from now. */
  expiresIn: ExpiryKey | 'keep';
  /** Empty = unlimited. */
  maxDownloads: string;
  /** Password changes are mutually exclusive by construction. */
  passwordMode: 'keep' | 'set' | 'remove';
  password: string;
}

type EditableTransfer = Pick<TransferDetail, 'title' | 'message' | 'maxDownloads' | 'hasPassword'>;

export function editDefaults(transfer: EditableTransfer): EditFormValues {
  return {
    title: transfer.title ?? '',
    message: transfer.message ?? '',
    expiresIn: 'keep',
    maxDownloads: transfer.maxDownloads === null ? '' : String(transfer.maxDownloads),
    passwordMode: 'keep',
    password: '',
  };
}

/** The PATCH body with only what changed (empty object = nothing to save). */
export function buildUpdate(
  values: EditFormValues,
  transfer: EditableTransfer,
): UpdateTransferRequest {
  const body: UpdateTransferRequest = {};
  const title = values.title.trim();
  if (title !== (transfer.title ?? '')) body.title = title || null;
  if (values.message.trim() !== (transfer.message ?? '').trim()) {
    body.message = values.message.trim() || null;
  }
  if (values.expiresIn !== 'keep') body.expiresIn = values.expiresIn;
  const maxDownloads = values.maxDownloads.trim();
  if (maxDownloads !== (transfer.maxDownloads === null ? '' : String(transfer.maxDownloads))) {
    // A non-numeric text becomes NaN so the schema rejects it.
    body.maxDownloads = maxDownloads === '' ? null : Number(maxDownloads);
  }
  if (values.passwordMode === 'set') body.password = values.password;
  if (values.passwordMode === 'remove' && transfer.hasPassword) body.removePassword = true;
  return body;
}

function message(t: TFunction, field: string, code: string): string {
  switch (field) {
    case 'title':
      return t('transfers.new.errors.titleLength', { max: TITLE_MAX_LENGTH });
    case 'message':
      return t('transfers.new.errors.messageLength', { max: MESSAGE_MAX_LENGTH });
    case 'password':
      return code === 'too_small'
        ? t('transfers.new.errors.passwordShort', { min: LINK_PASSWORD_MIN_LENGTH })
        : t('transfers.new.errors.passwordLong', { max: PASSWORD_MAX_LENGTH });
    case 'maxDownloads':
      return t('transfers.new.errors.maxDownloads', { max: MAX_DOWNLOADS_LIMIT });
    default:
      return t('errors.VALIDATION_ERROR');
  }
}

/** Resolver backed by the shared `updateTransferRequestSchema` (same rules as the API). */
export function createEditResolver(
  t: TFunction,
  transfer: EditableTransfer,
): Resolver<EditFormValues> {
  return (values): ResolverResult<EditFormValues> => {
    const body = buildUpdate(values, transfer);
    // An unchanged form is not a validation error: the dialog explains it on submit.
    if (Object.keys(body).length === 0) return { values, errors: {} };
    const parsed = updateTransferRequestSchema.safeParse(body);
    if (parsed.success) return { values, errors: {} };
    const errors: FieldErrors<EditFormValues> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? 'password');
      if (field in errors) continue;
      (errors as Record<string, unknown>)[field] = {
        type: 'validation',
        message: message(t, field, issue.code),
      };
    }
    return { values: {}, errors };
  };
}
