import { z } from 'zod';
import { appModeSchema } from './common.js';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  mode: appModeSchema,
  db: z.enum(['ok', 'error']),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
