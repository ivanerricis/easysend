import { z } from 'zod';
import { AppError } from '../http/errors.js';
import type { Logger } from '../logger.js';

const TIMEOUT_MS = 15_000;

/** Cloudflare error codes that mean "bad or insufficient API token". */
const AUTH_ERROR_CODES = new Set([1000, 6003, 6111, 9103, 9106, 9109, 10000]);

/** Cloudflare error codes of "this DNS record already exists". */
export const RECORD_EXISTS_CODES = new Set([81053, 81057, 81058]);

/** The permission a call needs, used as a hint when Cloudflare refuses it. */
export type CloudflarePermission = 'Zone:Read' | 'DNS:Edit' | 'Cloudflare Tunnel:Edit';

type Method = 'GET' | 'POST' | 'PUT';

const envelopeSchema = z.object({
  success: z.boolean().optional(),
  errors: z
    .array(z.object({ code: z.number().optional(), message: z.string().optional() }))
    .optional(),
  result: z.unknown().optional(),
});

export interface CloudflareRequestOptions<T> {
  /** Request body, sent as JSON. */
  body?: unknown;
  /** Schema of the `result` field (only the fields in use). */
  schema: z.ZodType<T>;
  /** Permission hinted to the admin when Cloudflare answers 401/403. */
  permission: CloudflarePermission;
}

export interface CloudflareClient {
  request<T>(method: Method, path: string, options: CloudflareRequestOptions<T>): Promise<T>;
  /** Like `request`, but resolves to `null` when Cloudflare answers HTTP 404. */
  requestOrNull<T>(
    method: Method,
    path: string,
    options: CloudflareRequestOptions<T>,
  ): Promise<T | null>;
}

const apiError = (status: number, codes: number[]): AppError =>
  new AppError('CLOUDFLARE_API_ERROR', 'Cloudflare returned an unexpected error', {
    status,
    codes,
  });

/**
 * Minimal Cloudflare v4 client. The token only goes into the Authorization header: it is never
 * logged and never part of an error, a detail or a log line (only method, path, status, codes).
 */
export function createCloudflareClient(
  fetchFn: typeof fetch,
  apiToken: string,
  logger: Logger,
  /** API base URL without a trailing slash (`config.cloudflareApiBase`). */
  apiBase: string,
): CloudflareClient {
  async function send<T>(
    method: Method,
    path: string,
    options: CloudflareRequestOptions<T>,
    nullOn404: boolean,
  ): Promise<T | null> {
    const logPath = path.split('?')[0];
    let response: Response;
    try {
      response = await fetchFn(`${apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      logger.warn(
        { method, path: logPath, reason: error instanceof Error ? error.name : 'unknown' },
        'cloudflare request failed',
      );
      throw apiError(0, []);
    }

    let envelope: z.infer<typeof envelopeSchema> | undefined;
    try {
      const parsed = envelopeSchema.safeParse(await response.json());
      envelope = parsed.success ? parsed.data : undefined;
    } catch {
      envelope = undefined;
    }
    const codes = (envelope?.errors ?? []).flatMap((e) => (e.code === undefined ? [] : [e.code]));
    logger.debug({ method, path: logPath, status: response.status, codes }, 'cloudflare response');

    if (response.status === 404 && nullOn404) return null;
    if (
      response.status === 401 ||
      response.status === 403 ||
      codes.some((c) => AUTH_ERROR_CODES.has(c))
    ) {
      throw new AppError(
        'CLOUDFLARE_TOKEN_INVALID',
        'The Cloudflare API token is invalid or lacks permissions',
        { permission: options.permission, status: response.status, codes },
      );
    }
    if (!response.ok || !envelope || envelope.success === false) {
      throw apiError(response.status, codes);
    }
    const result = options.schema.safeParse(envelope.result);
    if (!result.success) throw apiError(response.status, codes);
    return result.data;
  }

  return {
    request: async <T>(method: Method, path: string, options: CloudflareRequestOptions<T>) =>
      (await send(method, path, options, false)) as T,
    requestOrNull: (method, path, options) => send(method, path, options, true),
  };
}
