import { z } from 'zod';
import { EMAIL_MAX_LENGTH, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '../constants.js';

/** Opaque random text id. */
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
