import { z } from 'zod';
import type { UpdateStatusResponse } from '@easysend/shared';
import type { Clock } from '../clock.js';
import type { Logger } from '../logger.js';
import { compareSemver, parseSemver, stripV } from './semver.js';

const TIMEOUT_MS = 10_000;
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 60 * 1000;

/** Only the fields in use of the GitHub "latest release" answer. */
const releaseSchema = z.object({
  tag_name: z.string().min(1).max(64),
  html_url: z.url().refine((value) => value.startsWith('https://'), 'must be https'),
  published_at: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});

interface LatestRelease {
  version: string;
  url: string;
  publishedAt: number | null;
}

interface CacheEntry {
  /** Milliseconds since the epoch. */
  at: number;
  /** Null = the check failed. */
  release: LatestRelease | null;
}

export interface UpdateService {
  /**
   * Status for the admin panel. Contacts GitHub only when `enabled`, only when asked (no timer)
   * and not more than once per cache period unless `refresh` is set.
   */
  status(options: { enabled: boolean; refresh: boolean }): Promise<UpdateStatusResponse>;
}

export interface UpdateServiceDeps {
  url: string;
  currentVersion: string;
  fetch: typeof fetch;
  clock: Clock;
  logger: Logger;
}

export function createUpdateService(deps: UpdateServiceDeps): UpdateService {
  const { url, currentVersion, clock, logger, fetch: fetchFn } = deps;
  let cache: CacheEntry | undefined;
  let inFlight: Promise<CacheEntry> | undefined;

  /** One request to GitHub. Never throws and never logs a response body. */
  const fetchLatest = async (): Promise<LatestRelease | null> => {
    try {
      const response = await fetchFn(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `easysend/${currentVersion}`,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, 'update check failed');
        return null;
      }
      const parsed = releaseSchema.safeParse(await response.json());
      if (!parsed.success) {
        logger.warn({ reason: 'invalid response' }, 'update check failed');
        return null;
      }
      const release = parsed.data;
      if (release.draft === true || release.prerelease === true) {
        logger.warn({ reason: 'latest release is a draft or pre-release' }, 'update check failed');
        return null;
      }
      if (!parseSemver(release.tag_name)) {
        logger.warn({ reason: 'unexpected tag format' }, 'update check failed');
        return null;
      }
      const published = release.published_at ? Date.parse(release.published_at) : Number.NaN;
      return {
        version: stripV(release.tag_name),
        url: release.html_url,
        publishedAt: Number.isFinite(published) ? Math.floor(published / 1000) : null,
      };
    } catch (error) {
      logger.warn(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'update check failed',
      );
      return null;
    }
  };

  const refreshCache = (): Promise<CacheEntry> => {
    inFlight ??= fetchLatest()
      .then((release) => {
        const entry: CacheEntry = { at: clock(), release };
        cache = entry;
        return entry;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };

  const isFresh = (entry: CacheEntry): boolean =>
    clock() - entry.at < (entry.release ? SUCCESS_TTL_MS : FAILURE_TTL_MS);

  const empty = {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
    publishedAt: null,
    checkedAt: null,
  } as const;

  return {
    async status({ enabled, refresh }) {
      if (!enabled) return { ...empty, enabled: false, status: 'disabled' };
      const entry = cache && !refresh && isFresh(cache) ? cache : await refreshCache();
      const checkedAt = Math.floor(entry.at / 1000);
      if (!entry.release) return { ...empty, enabled: true, checkedAt, status: 'unavailable' };

      const current = parseSemver(currentVersion);
      const latest = parseSemver(entry.release.version);
      return {
        enabled: true,
        currentVersion,
        latestVersion: entry.release.version,
        updateAvailable: current !== null && latest !== null && compareSemver(latest, current) > 0,
        releaseUrl: entry.release.url,
        publishedAt: entry.release.publishedAt,
        checkedAt,
        status: 'ok',
      };
    },
  };
}
