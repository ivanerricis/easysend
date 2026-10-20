export type QuotaUnit = 'MiB' | 'GiB';

export const QUOTA_UNITS: readonly QuotaUnit[] = ['MiB', 'GiB'];

const MULTIPLIER: Record<QuotaUnit, number> = { MiB: 1024 ** 2, GiB: 1024 ** 3 };

/**
 * Converts the quota text field to bytes. Empty = no quota (`null`); anything that is not a
 * positive number gives `undefined` (invalid). Accepts a decimal comma.
 */
export function quotaToBytes(value: string, unit: QuotaUnit): number | null | undefined {
  const text = value.trim().replace(',', '.');
  if (text === '') return null;
  if (!/^\d+(\.\d+)?$/.test(text)) return undefined;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const bytes = Math.round(amount * MULTIPLIER[unit]);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined;
}

/** Splits stored bytes into the value/unit shown in the form (GiB when it divides evenly). */
export function bytesToQuotaFields(bytes: number | null): { value: string; unit: QuotaUnit } {
  if (bytes === null) return { value: '', unit: 'GiB' };
  if (bytes % MULTIPLIER.GiB === 0) return { value: String(bytes / MULTIPLIER.GiB), unit: 'GiB' };
  const mib = Math.round((bytes / MULTIPLIER.MiB) * 100) / 100;
  return { value: String(mib), unit: 'MiB' };
}
