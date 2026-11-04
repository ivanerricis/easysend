import { describe, expect, it, vi } from 'vitest';
import { installStaleChunkReload, shouldReloadForStaleChunk } from './stale-chunk';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('shouldReloadForStaleChunk', () => {
  it('reloads once, then not again within 10 seconds', () => {
    const storage = memoryStorage();
    expect(shouldReloadForStaleChunk(100_000, storage)).toBe(true);
    expect(shouldReloadForStaleChunk(105_000, storage)).toBe(false);
    expect(shouldReloadForStaleChunk(111_000, storage)).toBe(true);
  });

  it('reloads when storage is missing or throws', () => {
    expect(shouldReloadForStaleChunk(1, null)).toBe(true);
    const broken = memoryStorage();
    broken.getItem = () => {
      throw new Error('blocked');
    };
    expect(shouldReloadForStaleChunk(1, broken)).toBe(true);
  });
});

describe('installStaleChunkReload', () => {
  it('reloads the page on vite:preloadError', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    const win = Object.assign(target, { location: { reload } }) as unknown as Window;
    window.sessionStorage.clear();
    installStaleChunkReload(win);
    target.dispatchEvent(new Event('vite:preloadError'));
    expect(reload).toHaveBeenCalledTimes(1);
    target.dispatchEvent(new Event('vite:preloadError'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
