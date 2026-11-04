import {
  LINK_PASSWORD_MIN_LENGTH,
  MAX_SUBMISSIONS_LIMIT,
  MESSAGE_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  createUploadRequestSchema,
  updateUploadRequestSchema,
  type ExpiryKey,
  type UpdateUploadRequest,
  type UploadRequestSummary,
} from '@easysend/shared';
import type { TFunction } from 'i18next';
import type { FieldErrors, Resolver, ResolverResult } from 'react-hook-form';
import type { CreateUploadRequestInput } from '@/lib/api/requests';
import { bytesToQuotaFields, quotaToBytes, type QuotaUnit } from '../admin/quota';

/** Values of the create/edit form. Text inputs hold strings; `buildCreate`/`buildUpdate` convert. */
export interface RequestFormValues {
  title: string;
  message: string;
  /** `keep` (edit only) leaves the expiry alone; a key restarts the countdown from now. */
  expiresIn: ExpiryKey | 'keep';
  /** Create only uses `set` (when a password is typed); edit offers all three. */
  passwordMode: 'keep' | 'set' | 'remove';
  password: string;
  /** Empty = no limit. */
  sizeValue: string;
  sizeUnit: QuotaUnit;
  /** Empty = no limit. */
  maxSubmissions: string;
  requireName: boolean;
  requireEmail: boolean;
}

export type EditableRequest = Pick<
  UploadRequestSummary,
  'title' | 'maxTotalBytes' | 'maxSubmissions' | 'requireName' | 'requireEmail' | 'hasPassword'
> & { message: string | null };

export const CREATE_DEFAULTS: RequestFormValues = {
  title: '',
  message: '',
  expiresIn: '1w',
  passwordMode: 'keep',
  password: '',
  sizeValue: '',
  sizeUnit: 'GiB',
  maxSubmissions: '',
  requireName: false,
  requireEmail: false,
};

export function editDefaults(request: EditableRequest): RequestFormValues {
  const size = bytesToQuotaFields(request.maxTotalBytes);
  return {
    title: request.title,
    message: request.message ?? '',
    expiresIn: 'keep',
    passwordMode: 'keep',
    password: '',
    sizeValue: size.value,
    sizeUnit: size.unit,
    maxSubmissions: request.maxSubmissions === null ? '' : String(request.maxSubmissions),
    requireName: request.requireName,
    requireEmail: request.requireEmail,
  };
}

/** A non-numeric text becomes NaN so the shared schema rejects it. */
function submissionsOf(text: string): number | null {
  const value = text.trim();
  return value === '' ? null : /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

/** Bytes of the size fields: `null` = no limit, `NaN` = invalid (rejected by the schema). */
function bytesOf(values: Pick<RequestFormValues, 'sizeValue' | 'sizeUnit'>): number | null {
  const bytes = quotaToBytes(values.sizeValue, values.sizeUnit);
  return bytes === undefined ? Number.NaN : bytes;
}

/** POST body: empty optional fields are left out. */
export function buildCreate(values: RequestFormValues): CreateUploadRequestInput {
  const body: CreateUploadRequestInput = {
    title: values.title.trim(),
    expiresIn: values.expiresIn === 'keep' ? '1w' : values.expiresIn,
    requireName: values.requireName,
    requireEmail: values.requireEmail,
  };
  if (values.message.trim()) body.message = values.message.trim();
  if (values.password) body.password = values.password;
  const bytes = bytesOf(values);
  if (bytes !== null) body.maxTotalBytes = bytes;
  const submissions = submissionsOf(values.maxSubmissions);
  if (submissions !== null) body.maxSubmissions = submissions;
  return body;
}

/** The PATCH body with only what changed (empty object = nothing to save). */
export function buildUpdate(
  values: RequestFormValues,
  request: EditableRequest,
): UpdateUploadRequest {
  const body: UpdateUploadRequest = {};
  const title = values.title.trim();
  if (title !== request.title) body.title = title;
  if (values.message.trim() !== (request.message ?? '').trim()) {
    body.message = values.message.trim() || null;
  }
  if (values.expiresIn !== 'keep') body.expiresIn = values.expiresIn;
  const original = bytesToQuotaFields(request.maxTotalBytes);
  if (
    values.sizeValue.trim() !== original.value ||
    (values.sizeValue.trim() !== '' && values.sizeUnit !== original.unit)
  ) {
    body.maxTotalBytes = bytesOf(values);
  }
  const submissions = submissionsOf(values.maxSubmissions);
  if (submissions !== request.maxSubmissions) body.maxSubmissions = submissions;
  if (values.requireName !== request.requireName) body.requireName = values.requireName;
  if (values.requireEmail !== request.requireEmail) body.requireEmail = values.requireEmail;
  if (values.passwordMode === 'set') body.password = values.password;
  if (values.passwordMode === 'remove' && request.hasPassword) body.removePassword = true;
  return body;
}

const FIELD_OF_PATH: Record<string, keyof RequestFormValues> = {
  maxTotalBytes: 'sizeValue',
};

function message(t: TFunction, field: string, code: string): string {
  switch (field) {
    case 'title':
      return t('requests.form.errors.titleLength', { max: TITLE_MAX_LENGTH });
    case 'message':
      return t('requests.form.errors.messageLength', { max: MESSAGE_MAX_LENGTH });
    case 'password':
      return code === 'too_small'
        ? t('requests.form.errors.passwordShort', { min: LINK_PASSWORD_MIN_LENGTH })
        : t('requests.form.errors.passwordLong', { max: PASSWORD_MAX_LENGTH });
    case 'sizeValue':
      return t('requests.form.errors.maxSize');
    case 'maxSubmissions':
      return t('requests.form.errors.maxSubmissions', { max: MAX_SUBMISSIONS_LIMIT });
    default:
      return t('errors.VALIDATION_ERROR');
  }
}

/**
 * Resolver backed by the shared create/update schemas (same rules as the API). With `request`
 * the form is an edit: an unchanged form is not a validation error, the dialog explains it.
 */
export function createRequestResolver(
  t: TFunction,
  request?: EditableRequest,
): Resolver<RequestFormValues> {
  return (values): ResolverResult<RequestFormValues> => {
    let issues: { code: string; path: PropertyKey[] }[] = [];
    if (request) {
      const body = buildUpdate(values, request);
      if (Object.keys(body).length === 0) return { values, errors: {} };
      const parsed = updateUploadRequestSchema.safeParse(body);
      if (!parsed.success) issues = parsed.error.issues;
    } else {
      const parsed = createUploadRequestSchema.safeParse(buildCreate(values));
      if (!parsed.success) issues = parsed.error.issues;
    }
    if (issues.length === 0) return { values, errors: {} };
    const errors: FieldErrors<RequestFormValues> = {};
    for (const issue of issues) {
      const path = String(issue.path[0] ?? 'password');
      const field = FIELD_OF_PATH[path] ?? path;
      if (field in errors) continue;
      (errors as Record<string, unknown>)[field] = {
        type: 'validation',
        message: message(t, field, issue.code),
      };
    }
    return { values: {}, errors };
  };
}
