/** Numeric `major.minor.patch` triple. */
export type Semver = readonly [number, number, number];

/**
 * Parses a plain release number (`1.2.3` or `v1.2.3`). Anything else, pre-releases and build
 * labels included (`0.0.0-dev`, `local`), is not a release and gives `null`.
 */
export function parseSemver(value: string): Semver | null {
  const match = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative when `a < b`, 0 when equal, positive when `a > b`. */
export function compareSemver(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i += 1) {
    const diff = a[i]! - b[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Version without the leading `v`. */
export const stripV = (value: string): string => value.trim().replace(/^v/, '');
