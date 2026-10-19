import { randomBytes } from 'node:crypto';
import { and, eq, lte, ne, or } from 'drizzle-orm';
import type { Request, RequestHandler, Response } from 'express';
import { nowSeconds, type Clock } from '../clock.js';
import { sha256Hex } from '../crypto/hash.js';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema/index.js';
import { SESSION_COOKIE, clearCookie, readCookie, setCookie } from '../http/cookies.js';
import { ipHash as hashIp, type ClientIpResolver } from '../http/client-ip.js';
import { AUTH_POLICY } from './policy.js';

export type SessionRow = typeof sessions.$inferSelect;
export type UserRow = typeof users.$inferSelect;

/** `mfa-pending`: password accepted, second factor missing. `session`: fully authenticated. */
export type SessionLevel = 'mfa-pending' | 'session';

/** What `loadSession` stores in `req.auth`. */
export interface AuthContext {
  session: SessionRow;
  user: UserRow;
  level: SessionLevel;
}

export interface StartSessionInput {
  userId: string;
  /** True once the second factor is verified (or not required). False opens a 10-minute pending session. */
  mfaVerified: boolean;
}

export interface SessionService {
  /**
   * Opens a new session for the user, sets the `es_session` cookie and fills `req.auth`.
   * Any session the request already carries is destroyed first (the id is regenerated at login,
   * second-factor completion, password change and role change).
   */
  start(req: Request, res: Response, input: StartSessionInput): AuthContext;
  /** Destroys the session of the request and clears the cookie. */
  end(req: Request, res: Response): void;
  /** Deletes one session by id. */
  revoke(sessionId: string): void;
  /** Deletes every session of the user, optionally keeping one. Returns how many were removed. */
  revokeAllForUser(userId: string, exceptSessionId?: string): number;
  /** Deletes expired rows (idle or absolute). Returns how many were removed. */
  purgeExpired(): number;
  /** Reads the cookie and sets `req.auth` when the session is valid. Never rejects: guards do that. */
  loadSession: RequestHandler;
}

export function createSessionService(deps: {
  db: Db;
  clock: Clock;
  clientIp: ClientIpResolver;
  ipHashKey: Uint8Array;
}): SessionService {
  const { db, clock, clientIp, ipHashKey } = deps;
  const { session: policy } = AUTH_POLICY;

  const select = (id: string): AuthContext | undefined => {
    const row = db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, id))
      .get();
    if (!row) return undefined;
    return {
      session: row.session,
      user: row.user,
      level: row.session.mfaVerified ? 'session' : 'mfa-pending',
    };
  };

  const remove = (id: string): void => {
    db.delete(sessions).where(eq(sessions.id, id)).run();
  };

  const idleExpiry = (now: number, absolute: number): number =>
    Math.min(now + policy.idleSeconds, absolute);

  return {
    start(req, res, input) {
      const now = nowSeconds(clock);
      const token = randomBytes(32).toString('base64url');
      const id = sha256Hex(token);
      const absoluteExpiresAt = now + policy.absoluteSeconds;
      const expiresAt = input.mfaVerified
        ? idleExpiry(now, absoluteExpiresAt)
        : now + policy.mfaPendingSeconds;

      db.transaction((tx) => {
        if (req.auth) tx.delete(sessions).where(eq(sessions.id, req.auth.session.id)).run();
        tx.insert(sessions)
          .values({
            id,
            userId: input.userId,
            expiresAt,
            absoluteExpiresAt,
            createdAt: now,
            lastSeenAt: now,
            ipHash: hashIp(ipHashKey, clientIp(req)),
            userAgent: (req.get('user-agent') ?? '').slice(0, policy.userAgentMaxLength) || null,
            mfaVerified: input.mfaVerified,
          })
          .run();
      });

      setCookie(res, SESSION_COOKIE, token, expiresAt - now);
      const context = select(id);
      if (!context) throw new Error('Session row missing right after insert');
      req.auth = context;
      return context;
    },

    end(req, res) {
      if (req.auth) remove(req.auth.session.id);
      delete req.auth;
      clearCookie(res, SESSION_COOKIE);
    },

    revoke: remove,

    revokeAllForUser(userId, exceptSessionId) {
      const where = exceptSessionId
        ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId))
        : eq(sessions.userId, userId);
      return db.delete(sessions).where(where).run().changes;
    },

    purgeExpired() {
      const now = nowSeconds(clock);
      return db
        .delete(sessions)
        .where(or(lte(sessions.expiresAt, now), lte(sessions.absoluteExpiresAt, now)))
        .run().changes;
    },

    loadSession(req, res, next) {
      try {
        const token = readCookie(req, SESSION_COOKIE);
        if (!token) return next();

        const context = /^[A-Za-z0-9_-]{43}$/.test(token) ? select(sha256Hex(token)) : undefined;
        const now = nowSeconds(clock);
        const { session, user } = context ?? {};
        if (
          !context ||
          !session ||
          !user ||
          user.disabled ||
          now >= session.expiresAt ||
          now >= session.absoluteExpiresAt
        ) {
          if (session) remove(session.id);
          clearCookie(res, SESSION_COOKIE);
          return next();
        }

        // Sliding idle expiry, written at most every few minutes. Pending sessions never slide.
        if (session.mfaVerified && now - session.lastSeenAt >= policy.lastSeenRefreshSeconds) {
          const expiresAt = idleExpiry(now, session.absoluteExpiresAt);
          db.update(sessions)
            .set({ lastSeenAt: now, expiresAt })
            .where(eq(sessions.id, session.id))
            .run();
          context.session = { ...session, lastSeenAt: now, expiresAt };
          setCookie(res, SESSION_COOKIE, token, expiresAt - now);
        }

        req.auth = context;
        next();
      } catch (error) {
        next(error);
      }
    },
  };
}
