import { cloudflareRequestSchema } from '@easysend/shared';
import { z } from 'zod';

/**
 * Cloudflare form shared by the setup wizard and the admin settings. Domain and subdomain are
 * lowercased, an empty subdomain is left out, and the result is validated by the shared schema.
 */
export const cloudflareFormSchema = z
  .object({ domain: z.string(), subdomain: z.string(), apiToken: z.string() })
  .transform((v) => ({
    domain: v.domain.trim().toLowerCase(),
    ...(v.subdomain.trim() === '' ? {} : { subdomain: v.subdomain.trim().toLowerCase() }),
    apiToken: v.apiToken.trim(),
  }))
  .pipe(cloudflareRequestSchema);
export type CloudflareFormValues = z.input<typeof cloudflareFormSchema>;

export const CLOUDFLARE_FORM_DEFAULTS: CloudflareFormValues = {
  domain: '',
  subdomain: '',
  apiToken: '',
};
