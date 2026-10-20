import {
  LINK_PASSWORD_MIN_LENGTH,
  MAX_DOWNLOADS_LIMIT,
  MAX_RECIPIENTS,
  MESSAGE_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  createTransferRequestSchema,
  emailSchema,
  type ExpiryKey,
  type TransferMode,
} from '@easysend/shared';
import type { FieldErrors, Resolver, ResolverResult } from 'react-hook-form';
import type { TFunction } from 'i18next';
import type { CreateTransferInput } from '@/lib/api/transfers';

/** Values of the options form. Text inputs hold strings; they are converted by `toCreateRequest`. */
export interface TransferFormValues {
  mode: TransferMode;
  title: string;
  message: string;
  recipients: string[];
  /** Text typed in the recipients input and not added yet. */
  recipientInput: string;
  expiresIn: ExpiryKey;
  password: string;
  maxDownloads: string;
}

export const DEFAULT_FORM_VALUES: TransferFormValues = {
  mode: 'link',
  title: '',
  message: '',
  recipients: [],
  recipientInput: '',
  expiresIn: '1w',
  password: '',
  maxDownloads: '',
};

/** Builds the API body: empty optional fields are left out, recipients only in email mode. */
export function toCreateRequest(values: TransferFormValues): CreateTransferInput {
  const maxDownloads = values.maxDownloads.trim();
  const body: CreateTransferInput = { mode: values.mode, expiresIn: values.expiresIn };
  const title = values.title.trim();
  if (title) body.title = title;
  if (values.message.trim()) body.message = values.message;
  if (values.mode === 'email') body.recipients = values.recipients;
  if (values.password) body.password = values.password;
  if (maxDownloads) body.maxDownloads = Number(maxDownloads);
  return body;
}

type IssueLike = { code: string; message: string; path: PropertyKey[] };

function issueMessage(t: TFunction, field: string, issue: IssueLike): string {
  switch (field) {
    case 'title':
      return t('transfers.new.errors.titleLength', { max: TITLE_MAX_LENGTH });
    case 'message':
      return t('transfers.new.errors.messageLength', { max: MESSAGE_MAX_LENGTH });
    case 'password':
      return issue.code === 'too_small'
        ? t('transfers.new.errors.passwordShort', { min: LINK_PASSWORD_MIN_LENGTH })
        : t('transfers.new.errors.passwordLong', { max: PASSWORD_MAX_LENGTH });
    case 'maxDownloads':
      return t('transfers.new.errors.maxDownloads', { max: MAX_DOWNLOADS_LIMIT });
    case 'recipients':
      if (issue.code === 'too_big') {
        return t('transfers.new.errors.recipientsMax', { max: MAX_RECIPIENTS });
      }
      if (issue.message.includes('unique')) return t('transfers.new.errors.recipientsUnique');
      if (issue.message.includes('required')) return t('transfers.new.errors.recipientsRequired');
      return t('transfers.new.errors.recipientsInvalid');
    default:
      return t('errors.VALIDATION_ERROR');
  }
}

/**
 * react-hook-form resolver backed by the shared `createTransferRequestSchema`, so the browser and
 * the API validate exactly the same rules. Error messages are translated here.
 */
export function createTransferResolver(t: TFunction): Resolver<TransferFormValues> {
  return (values): ResolverResult<TransferFormValues> => {
    const maxDownloads = values.maxDownloads.trim();
    if (maxDownloads && !/^\d+$/.test(maxDownloads)) {
      return {
        values: {},
        errors: {
          maxDownloads: {
            type: 'validation',
            message: t('transfers.new.errors.maxDownloads', { max: MAX_DOWNLOADS_LIMIT }),
          },
        },
      };
    }
    const parsed = createTransferRequestSchema.safeParse(toCreateRequest(values));
    if (parsed.success) return { values, errors: {} };
    const errors: FieldErrors<TransferFormValues> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (!field || field in errors) continue;
      (errors as Record<string, unknown>)[field] = {
        type: 'validation',
        message: issueMessage(t, field, issue),
      };
    }
    return { values: {}, errors };
  };
}

/** Splits pasted text on commas, semicolons, spaces and line breaks. */
export function splitAddresses(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export interface AddResult {
  recipients: string[];
  error: string | null;
}

/** Adds the addresses found in `text` to `current`, validating, deduplicating and capping them. */
export function addAddresses(current: string[], text: string, t: TFunction): AddResult {
  const next = [...current];
  for (const address of splitAddresses(text)) {
    if (!emailSchema.safeParse(address).success) {
      return {
        recipients: current,
        error: t('transfers.new.errors.recipientInvalid', { email: address }),
      };
    }
    if (next.some((existing) => existing.toLowerCase() === address.toLowerCase())) continue;
    if (next.length >= MAX_RECIPIENTS) {
      return {
        recipients: current,
        error: t('transfers.new.errors.recipientsMax', { max: MAX_RECIPIENTS }),
      };
    }
    next.push(address);
  }
  return { recipients: next, error: null };
}
