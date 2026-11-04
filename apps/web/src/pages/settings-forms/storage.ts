import {
  STORAGE_DRIVERS,
  s3InputSchema,
  type S3Public,
  type StorageUpdateRequest,
} from '@easysend/shared';
import type { TFunction } from 'i18next';
import { z } from 'zod';
import { hasErrorCode } from '@/lib/errors';
import { failureReason } from './smtp';

/**
 * Storage form shared by the setup wizard and the admin settings. The form holds strings; the
 * submit handler gets a `StorageUpdateRequest`. S3 fields are validated with the shared
 * `s3InputSchema` only when the driver is `s3`, and issues are reported on the field itself.
 */
const S3_FIELDS = [
  'endpoint',
  'region',
  'bucket',
  'prefix',
  'accessKeyId',
  'secretAccessKey',
] as const;

export const storageFormSchema = z
  .object({
    driver: z.enum(STORAGE_DRIVERS),
    endpoint: z.string(),
    region: z.string(),
    bucket: z.string(),
    prefix: z.string(),
    forcePathStyle: z.boolean(),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
  })
  .transform((v, ctx): StorageUpdateRequest => {
    if (v.driver === 'local') return { driver: 'local' };
    const parsed = s3InputSchema.safeParse({
      endpoint: v.endpoint.trim(),
      region: v.region.trim(),
      bucket: v.bucket.trim(),
      prefix: v.prefix.trim().replace(/^\/+/, ''),
      forcePathStyle: v.forcePathStyle,
      accessKeyId: v.accessKeyId.trim(),
      // An empty secret keeps the saved one.
      secretAccessKey: v.secretAccessKey === '' ? undefined : v.secretAccessKey,
    });
    if (parsed.success) return { driver: 's3', s3: parsed.data };
    const seen = new Set<string>();
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (seen.has(field) || !(S3_FIELDS as readonly string[]).includes(field)) continue;
      seen.add(field);
      const empty = v[field as (typeof S3_FIELDS)[number]].trim() === '';
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: empty ? 'setup.storage.errors.required' : `setup.storage.errors.${field}`,
      });
    }
    return z.NEVER;
  });
export type StorageFormValues = z.input<typeof storageFormSchema>;

/** Form values for the saved settings (or empty ones when S3 was never configured). */
export function storageFormDefaults(
  driver: StorageFormValues['driver'],
  s3: S3Public | null,
): StorageFormValues {
  return {
    driver,
    endpoint: s3?.endpoint ?? '',
    region: s3?.region ?? 'auto',
    bucket: s3?.bucket ?? '',
    prefix: s3?.prefix ?? '',
    forcePathStyle: s3?.forcePathStyle ?? false,
    accessKeyId: s3?.accessKeyId ?? '',
    secretAccessKey: '',
  };
}

/** Comparable form of the S3 values: any difference from the tested snapshot invalidates the test. */
export function storageSnapshot(values: Partial<StorageFormValues>): string {
  return JSON.stringify([
    values.endpoint?.trim(),
    values.region?.trim(),
    values.bucket?.trim(),
    values.prefix?.trim(),
    values.forcePathStyle === true,
    values.accessKeyId?.trim(),
    values.secretAccessKey,
  ]);
}

/** Message for a failed storage test with its safe reason, or null for any other error. */
export function storageTestFailureText(t: TFunction, error: unknown): string | null {
  if (!hasErrorCode(error, 'STORAGE_TEST_FAILED')) return null;
  const reason = failureReason(error);
  const base = t('setup.storage.testFailed');
  return reason
    ? `${base} ${t('setup.storage.reasonLabel')} ${t(`setup.storage.reasons.${reason}`, { defaultValue: reason })}`
    : base;
}
