import { z } from 'zod';
import {
  APP_MODES,
  EMAIL_MAX_LENGTH,
  FILE_PATH_MAX_LENGTH,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PASSWORD_MAX_LENGTH,
} from '../constants.js';

/** Opaque random text id. */
/** Folder of a file inside a transfer: segments joined by "/", empty string for the root. */
export const filePathSchema = z.string().max(FILE_PATH_MAX_LENGTH);

export const idSchema = z.string().min(1).max(64);

/** Unix timestamp in seconds, as stored in the database. */
export const unixSecondsSchema = z.number().int().nonnegative();

/** Size in bytes. */
export const byteSizeSchema = z.number().int().nonnegative();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginatedSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(PAGE_SIZE_MAX),
  });

/** Email address, bounded to the RFC 5321 maximum. */
export const emailSchema = z.email().max(EMAIL_MAX_LENGTH);

/** `{ ok: true }` body for operations that return nothing else. */
export const okResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof okResponseSchema>;

/** `:id` path parameter. */
export const idParamsSchema = z.object({ id: idSchema });

/** The password a user types to prove who they are (no strength rules: it may be an old one). */
export const currentPasswordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

/** How the instance runs: `local` (development) or `production`. */
export const appModeSchema = z.enum(APP_MODES);

/** Rejects an object body with no field at all (PATCH-style requests). */
export const atLeastOneField = <T extends z.ZodObject>(schema: T) =>
  schema.refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });
