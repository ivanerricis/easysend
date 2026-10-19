export interface ByteRange {
  start: number;
  /** Inclusive. */
  end: number;
}

/** `ignore`: serve the whole file (no or unusable header). `unsatisfiable`: answer 416. */
export type RangeResult =
  { kind: 'ignore' } | { kind: 'unsatisfiable' } | { kind: 'range'; range: ByteRange };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Parses a `Range` header against a file of `size` bytes. Supports one range: `a-b`, `a-` and
 * `-n`. Multiple ranges, other units and malformed values are ignored (full 200 response),
 * which RFC 9110 allows. An end past the file is clamped.
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  const ignore: RangeResult = { kind: 'ignore' };
  if (!header) return ignore;
  const match = SINGLE_RANGE.exec(header.trim());
  if (!match) return ignore;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return ignore;

  const a = first === '' ? undefined : Number(first);
  const b = last === '' ? undefined : Number(last);
  if (
    (a !== undefined && !Number.isSafeInteger(a)) ||
    (b !== undefined && !Number.isSafeInteger(b))
  ) {
    return ignore;
  }

  if (a === undefined) {
    // Suffix range: the last `b` bytes.
    if (b === undefined || b === 0 || size === 0) return { kind: 'unsatisfiable' };
    return { kind: 'range', range: { start: Math.max(size - b, 0), end: size - 1 } };
  }
  if (b !== undefined && b < a) return ignore;
  if (a >= size) return { kind: 'unsatisfiable' };
  return { kind: 'range', range: { start: a, end: Math.min(b ?? size - 1, size - 1) } };
}
