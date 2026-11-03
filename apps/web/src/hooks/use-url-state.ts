import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

/** Reads/writes list filters in the URL. Changing any key except `page` resets the page. */
export function useUrlState() {
  const [params, setParams] = useSearchParams();
  const update = useCallback(
    (patch: Record<string, string | undefined>) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === '') next.delete(key);
            else next.set(key, value);
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  return { params, update, page };
}

/** Value that follows `value` after `delay` ms without changes. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/**
 * Search box bound to the `q` URL param: the URL (and so the list query) changes only after
 * typing stops, and the box follows back/forward navigation without rewriting what is being typed.
 */
export function useUrlSearch(
  q: string,
  update: (patch: Record<string, string | undefined>) => void,
) {
  const [search, setSearch] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  if (q !== syncedQ) {
    setSyncedQ(q);
    if (q !== search.trim()) setSearch(q);
  }
  const debounced = useDebouncedValue(search.trim());
  useEffect(() => {
    if (debounced !== q) update({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the typed value
  }, [debounced]);
  return [search, setSearch] as const;
}
