/**
 * After an update the hashed chunks of the previous build are gone: a tab still running the old
 * bundle gets a 404 on the next lazy route. Vite reports it with the `vite:preloadError` event;
 * we reload the page once so the tab picks up the new index.html (served with no-cache).
 * A timestamp in sessionStorage stops a reload loop if the chunk is missing for another reason.
 */
const KEY = 'easysend-chunk-reload';
const MIN_INTERVAL_MS = 10_000;

export function shouldReloadForStaleChunk(now: number, storage: Storage | null): boolean {
  try {
    const stored = storage?.getItem(KEY);
    const last = stored == null ? Number.NaN : Number(stored);
    if (Number.isFinite(last) && now - last < MIN_INTERVAL_MS) return false;
    storage?.setItem(KEY, String(now));
  } catch {
    // Storage unavailable: reload anyway; without storage a loop is still bounded by the user.
  }
  return true;
}

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function installStaleChunkReload(win: Window = window): void {
  win.addEventListener('vite:preloadError', () => {
    if (shouldReloadForStaleChunk(Date.now(), sessionStorageOrNull())) win.location.reload();
  });
}
