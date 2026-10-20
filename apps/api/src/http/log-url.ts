/**
 * Masks what must never reach a log line from a request URL: download tokens (they are
 * bearer secrets) and the query string (it may carry tokens or codes). Only the path is kept.
 */
const TOKEN_PATHS = [/^(\/api\/downloads\/)[^/?#]+/i, /^(\/d\/)[^/?#]+/i];

export function maskLogUrl(url: string): string {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  for (const pattern of TOKEN_PATHS) {
    if (pattern.test(path)) return path.replace(pattern, '$1[token]');
  }
  return path;
}
