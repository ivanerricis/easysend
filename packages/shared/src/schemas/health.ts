import { z } from 'zod';
import { APP_MODES } from '../constants.js';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  mode: z.enum(APP_MODES),
  db: z.enum(['ok', 'error']),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
