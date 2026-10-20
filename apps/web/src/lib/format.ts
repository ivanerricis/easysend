/** Locale-aware formatters. Timestamps are Unix seconds, as everywhere in the API. */

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

function number(value: number, locale: string, maximumFractionDigits: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

/** Binary units (1 KiB = 1024 B); one decimal below 100 of a unit, none above. */
export function formatBytes(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 100 ? 1 : 0;
  return `${number(value, locale, digits)} ${BYTE_UNITS[unit]}`;
}

export function formatDate(unixSeconds: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(unixSeconds * 1000);
}

export function formatDateTime(unixSeconds: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    unixSeconds * 1000,
  );
}

const RELATIVE_STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "in 3 days" / "2 hours ago" relative to `now` (Unix seconds, defaults to the current time). */
export function formatRelative(
  unixSeconds: number,
  locale: string,
  now: number = Math.floor(Date.now() / 1000),
): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diff = unixSeconds - now;
  const abs = Math.abs(diff);
  for (const [unit, size] of RELATIVE_STEPS) {
    if (abs >= size) return formatter.format(Math.trunc(diff / size), unit);
  }
  return formatter.format(Math.trunc(diff), 'second');
}

/** Compact duration for ETAs: "45 s", "3 min 20 s", "2 h 05 min". */
export function formatDuration(seconds: number, locale: string): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const n = (value: number) => number(value, locale, 0);
  if (h > 0) return `${n(h)} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${n(m)} min ${String(s).padStart(2, '0')} s`;
  return `${n(s)} s`;
}

/** Transfer speed, e.g. "12,4 MiB/s". */
export function formatSpeed(bytesPerSecond: number, locale: string): string {
  return `${formatBytes(bytesPerSecond, locale)}/s`;
}
