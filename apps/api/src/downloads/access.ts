import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { hmacBase64url, sha256Hex, timingSafeEqualStrings } from '../crypto/hash.js';
import { transfers } from '../db/schema/index.js';
import { readCookie, setCookie } from '../http/cookies.js';
import { AppError } from '../http/errors.js';
import { assertNotLimited } from '../http/rate-limit.js';
import { effectiveStatus, type TransferRow } from '../transfers/service.js';
import { TRANSFER_POLICY } from '../transfers/policy.js';

export const DOWNLOAD_COOKIE = 'es_dl';
export const RESUME_COOKIE = 'es_dlr';

/**
 * Why a link cannot be used right now, as the error to answer, or null when it is usable.
 * `uploading` (draft) and `deleted` read as not found. The download limit also stops Range
 * requests (project decision).
 */
export function unavailableError(row: TransferRow, nowSec: number): AppError | null {
  const status = effectiveStatus(row, nowSec);
  if (status === 'uploading' || status === 'deleted') {
    return new AppError('TRANSFER_NOT_FOUND', 'Transfer not found');
  }
  if (status === 'revoked') return new AppError('TRANSFER_REVOKED', 'Transfer revoked');
  if (status === 'expired') return new AppError('TRANSFER_EXPIRED', 'Transfer expired');
  if (row.maxDownloads !== null && row.downloadCount >= row.maxDownloads) {
    return new AppError('DOWNLOAD_LIMIT_REACHED', 'Download limit reached');
  }
  return null;
}

/**
 * Common start of every public download request: counts the request against the per-IP limiter,
 * loads the transfer by token and refuses it when it is not available. Returns the row and the
 * caller's `ip_hash`.
 */
export async function resolveTransfer(
  ctx: AppContext,
  req: Request,
  res: Response,
  token: string,
): Promise<{ transfer: TransferRow; ipHash: string; nowSec: number }> {
  const ipHash = ctx.ipHashOf(req);
  assertNotLimited(res, await ctx.transferLimiters.download.consume(ipHash));

  const transfer = ctx.db.select().from(transfers).where(eq(transfers.token, token)).get();
  if (!transfer) throw new AppError('TRANSFER_NOT_FOUND', 'Transfer not found');
  const nowSec = nowSeconds(ctx.clock);
  const error = unavailableError(transfer, nowSec);
  if (error) throw error;
  return { transfer, ipHash, nowSec };
}

// ---- Unlock cookie ------------------------------------------------------------------------

/** Expiry and MAC of a signed `<exp>.<mac>` cookie value, or null when it is malformed. */
function parseSignedCookie(value: string | undefined): { exp: number; mac: string } | null {
  const match = value ? /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value) : null;
  return match ? { exp: Number(match[1]), mac: match[2]! } : null;
}

/**
 * First 16 hex characters of the hash of the link password hash: binds the cookie to the current
 * password, so changing or removing it invalidates cookies already handed out.
 */
const fingerprint = (passwordHash: string): string => sha256Hex(passwordHash).slice(0, 16);

function cookieMac(ctx: AppContext, transfer: TransferRow, exp: number): string {
  return hmacBase64url(
    ctx.keys.downloadCookie,
    `${transfer.id}:${exp}:${fingerprint(transfer.passwordHash ?? '')}`,
  );
}

/** Sets the `es_dl` cookie (`<exp>.<mac>`), scoped to the link path so plain `<a href>` works. */
export function setUnlockCookie(
  ctx: AppContext,
  res: Response,
  transfer: TransferRow,
  nowSec: number,
): void {
  const exp = nowSec + TRANSFER_POLICY.unlockCookieSeconds;
  setCookie(
    res,
    DOWNLOAD_COOKIE,
    `${exp}.${cookieMac(ctx, transfer, exp)}`,
    TRANSFER_POLICY.unlockCookieSeconds,
    {
      path: `/api/downloads/${transfer.token}`,
      sameSite: 'strict',
    },
  );
}

/** True when the link has no password or the request carries a valid, unexpired unlock cookie. */
export function isUnlocked(
  ctx: AppContext,
  req: Request,
  transfer: TransferRow,
  nowSec: number,
): boolean {
  if (transfer.passwordHash === null) return true;
  const cookie = parseSignedCookie(readCookie(req, DOWNLOAD_COOKIE));
  return (
    cookie !== null &&
    cookie.exp > nowSec &&
    timingSafeEqualStrings(cookie.mac, cookieMac(ctx, transfer, cookie.exp))
  );
}

export function assertUnlocked(
  ctx: AppContext,
  req: Request,
  transfer: TransferRow,
  nowSec: number,
): void {
  if (!isUnlocked(ctx, req, transfer, nowSec)) {
    throw new AppError('PASSWORD_REQUIRED', 'Password required');
  }
}

// ---- Resume cookie ------------------------------------------------------------------------

/** The `resume:` prefix keeps these MACs apart from the unlock cookie ones, made with the same key. */
const resumeMac = (ctx: AppContext, transfer: TransferRow, fileId: string, exp: number): string =>
  hmacBase64url(ctx.keys.downloadCookie, `resume:${transfer.id}:${fileId}:${exp}`);

/**
 * Sets the `es_dlr` cookie (`<exp>.<mac>`) after a counted download of one file, scoped to that
 * file's path: later Range requests carrying it are resumes and do not count again.
 */
export function setResumeCookie(
  ctx: AppContext,
  res: Response,
  transfer: TransferRow,
  fileId: string,
  nowSec: number,
): void {
  const exp = nowSec + TRANSFER_POLICY.resumeCookieSeconds;
  setCookie(
    res,
    RESUME_COOKIE,
    `${exp}.${resumeMac(ctx, transfer, fileId, exp)}`,
    TRANSFER_POLICY.resumeCookieSeconds,
    { path: `/api/downloads/${transfer.token}/files/${fileId}` },
  );
}

/** True when the request carries a valid, unexpired resume cookie for this file. */
export function hasResumeCookie(
  ctx: AppContext,
  req: Request,
  transfer: TransferRow,
  fileId: string,
  nowSec: number,
): boolean {
  const cookie = parseSignedCookie(readCookie(req, RESUME_COOKIE));
  return (
    cookie !== null &&
    cookie.exp > nowSec &&
    timingSafeEqualStrings(cookie.mac, resumeMac(ctx, transfer, fileId, cookie.exp))
  );
}
