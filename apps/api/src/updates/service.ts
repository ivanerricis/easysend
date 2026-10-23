import { z } from 'zod';
import type { AvailableVersion, UpdateStatusResponse } from '@easysend/shared';
import type { Clock } from '../clock.js';
import type { Logger } from '../logger.js';
import { compareSemver, parseSemver, stripV } from './semver.js';

const TIMEOUT_MS = 10_000;
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 60 * 1000;

/** Only the fields in use of a GitHub release. */
const releaseSchema = z.object({
  tag_name: z.string().min(1).max(64),
  html_url: z.url().refine((value) => value.startsWith('https://'), 'must be https'),
  published_at: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});
/** The "list releases" answer: at most 100 entries, each one checked on its own. */
const releaseListSchema = z.array(z.unknown()).max(100);

/** The most releases the service keeps and reports. */
const MAX_RELEASES = 30;

interface Release {
  version: string;
  url: string;
  publishedAt: number | null;
}

interface CacheEntry {
  /** Milliseconds since the epoch. */
  at: number;
  /** Published releases with a plain `X.Y.Z` tag, newest first. Null = the check failed. */
  releases: Release[] | null;
}

export interface UpdateService {
  /**
   * Status for the admin panel. Contacts GitHub only when `enabled`, only when asked (no timer)
   * and not more than once per cache period unless `refresh` is set.
   */
  status(options: { enabled: boolean; refresh: boolean }): Promise<UpdateStatusResponse>;
  /**
   * Whether `version` is a published release newer than the running one. Looks in the cache and,
   * when it is not there, asks GitHub once more (the list may be older than the release). Returns
   * false when the check is disabled or GitHub cannot be reached. Never throws.
   */
  isAvailable(version: string, options: { enabled: boolean }): Promise<boolean>;
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
  const current = parseSemver(currentVersion);
  let cache: CacheEntry | undefined;
  let inFlight: Promise<CacheEntry> | undefined;

  /** One request to GitHub. Never throws and never logs a response body. */
  const fetchReleases = async (): Promise<Release[] | null> => {
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
      const list = releaseListSchema.safeParse(await response.json());
      if (!list.success) {
        logger.warn({ reason: 'invalid response' }, 'update check failed');
        return null;
      }
      const releases: (Release & { parsed: NonNullable<ReturnType<typeof parseSemver>> })[] = [];
      for (const item of list.data) {
        const parsed = releaseSchema.safeParse(item);
        if (!parsed.success) continue;
        const release = parsed.data;
        if (release.draft === true || release.prerelease === true) continue;
        const semver = parseSemver(release.tag_name);
        if (!semver) continue;
        const published = release.published_at ? Date.parse(release.published_at) : Number.NaN;
        releases.push({
          version: stripV(release.tag_name),
          url: release.html_url,
          publishedAt: Number.isFinite(published) ? Math.floor(published / 1000) : null,
          parsed: semver,
        });
      }
      releases.sort((a, b) => compareSemver(b.parsed, a.parsed));
      return releases.slice(0, MAX_RELEASES).map(({ version, url: href, publishedAt }) => ({
        version,
        url: href,
        publishedAt,
      }));
    } catch (error) {
      logger.warn(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'update check failed',
      );
      return null;
    }
  };

  const refreshCache = (): Promise<CacheEntry> => {
    inFlight ??= fetchReleases()
      .then((releases) => {
        const entry: CacheEntry = { at: clock(), releases };
        cache = entry;
        return entry;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };

  const isFresh = (entry: CacheEntry): boolean =>
    clock() - entry.at < (entry.releases ? SUCCESS_TTL_MS : FAILURE_TTL_MS);

  /** Releases newer than the running version, newest first. Empty when it is not a release number. */
  const newerThanCurrent = (releases: Release[]): Release[] =>
    current === null
      ? []
      : releases.filter((release) => {
          const semver = parseSemver(release.version);
          return semver !== null && compareSemver(semver, current) > 0;
        });

  const empty = {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
    publishedAt: null,
    checkedAt: null,
    availableVersions: [] as AvailableVersion[],
  } as const;

  return {
    async status({ enabled, refresh }) {
      if (!enabled) return { ...empty, enabled: false, status: 'disabled' };
      const entry = cache && !refresh && isFresh(cache) ? cache : await refreshCache();
      const checkedAt = Math.floor(entry.at / 1000);
      if (!entry.releases) return { ...empty, enabled: true, checkedAt, status: 'unavailable' };

      const latest = entry.releases[0];
      const newer = newerThanCurrent(entry.releases);
      const availableVersions: AvailableVersion[] = newer.map((release) => ({
        version: release.version,
        releaseUrl: release.url,
        publishedAt: release.publishedAt,
      }));
      return {
        enabled: true,
        currentVersion,
        latestVersion: latest?.version ?? null,
        updateAvailable: newer.length > 0,
        releaseUrl: latest?.url ?? null,
        publishedAt: latest?.publishedAt ?? null,
        checkedAt,
        status: 'ok',
        availableVersions,
      };
    },

    async isAvailable(version, { enabled }) {
      if (!enabled) return false;
      const has = (entry: CacheEntry): boolean =>
        entry.releases !== null &&
        newerThanCurrent(entry.releases).some((r) => r.version === version);
      const usable = cache && isFresh(cache) ? cache : undefined;
      if (usable && has(usable)) return true;
      // Not in the cache (or no usable cache): one request, unless one was just made for this call.
      const fetched = await refreshCache();
      return has(fetched);
    },
  };
}
