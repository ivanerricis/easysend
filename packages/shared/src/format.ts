const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

/** Binary units (1 KiB = 1024 B); one decimal below 100 of a unit, none above; `—` if invalid. */
export function formatBytes(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const maximumFractionDigits = unit === 0 ? 0 : value < 100 ? 1 : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)} ${BYTE_UNITS[unit]}`;
}
