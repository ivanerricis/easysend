import { isIP } from 'node:net';
import type { Request } from 'express';
import type { AppConfig } from '../config.js';
import { hmacBase64url } from '../crypto/hash.js';

export type ClientIpResolver = (req: Request) => string;

/**
 * Client address of a request.
 * - local: always `req.ip`.
 * - production: the `CF-Connecting-IP` header (set by Cloudflare), but only when it is a valid
 *   address and the request crossed the whole trusted proxy chain (`req.ips` holds one entry per
 *   trusted hop). Otherwise `req.ip`, so a client talking to the stack directly cannot choose
 *   its own address.
 */
export function createClientIpResolver(
  config: Pick<AppConfig, 'mode' | 'trustProxy'>,
): ClientIpResolver {
  return (req) => {
    const fallback = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (config.mode !== 'production') return fallback;
    const header = req.headers['cf-connecting-ip'];
    if (typeof header !== 'string') return fallback;
    const candidate = header.trim();
    if (isIP(candidate) === 0) return fallback;
    return req.ips.length >= config.trustProxy ? candidate : fallback;
  };
}

/** IPs reach the logs and the database only as this keyed hash. */
export function ipHash(key: Uint8Array, ip: string): string {
  return hmacBase64url(key, ip);
}
