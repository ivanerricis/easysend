import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { CloudflareResponse } from '@easysend/shared';
import { nowSeconds } from '../clock.js';
import type { AppContext } from '../context.js';
import { AppError } from '../http/errors.js';
import { RECORD_EXISTS_CODES, createCloudflareClient } from './client.js';

/** The web container, as seen from cloudflared inside the compose network. */
const INGRESS_SERVICE = 'http://web:8080';
const TOKEN_FILE_NAME = 'tunnel-token';

const zonesSchema = z.array(
  z.object({ id: z.string(), name: z.string().optional(), account: z.object({ id: z.string() }) }),
);
const dnsRecordsSchema = z.array(
  z.object({ id: z.string(), type: z.string(), content: z.string().optional() }),
);
const tunnelSchema = z.object({ id: z.string(), deleted_at: z.string().nullish() });
const anySchema = z.unknown();
const tokenSchema = z.string().min(1);

export interface ConfigureTunnelInput {
  domain: string;
  subdomain?: string | undefined;
  apiToken: string;
}

/** Writes the tunnel token atomically (tmp file in the same dir, mode 600, rename). */
async function writeTokenFile(dir: string, token: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${TOKEN_FILE_NAME}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, token, { mode: 0o600 });
    await rename(tmp, path.join(dir, TOKEN_FILE_NAME));
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/**
 * Creates (or reuses) the tunnel of this instance, points its ingress to the web container,
 * creates the proxied CNAME and hands the tunnel token to cloudflared through `SHARED_DIR`.
 * The API token is used for this call only. Every step is safe to repeat after a failure; a DNS
 * conflict is detected before the tunnel is created, so it never leaves an orphan.
 */
export async function configureTunnel(
  ctx: AppContext,
  input: ConfigureTunnelInput,
): Promise<CloudflareResponse> {
  if (ctx.config.mode === 'local') {
    throw new AppError(
      'NOT_APPLICABLE_IN_LOCAL_MODE',
      'The tunnel can only be configured with APP_MODE=production',
    );
  }
  const domain = input.domain.toLowerCase();
  const hostname = (input.subdomain ? `${input.subdomain}.${domain}` : domain).toLowerCase();
  const client = createCloudflareClient(ctx.cloudflareFetch, input.apiToken, ctx.logger);
  const stored = ctx.settings.get('tunnel');

  // Zone of the domain (gives the account too).
  const zones = await client.request('GET', `/zones?name=${encodeURIComponent(domain)}`, {
    schema: zonesSchema,
    permission: 'Zone:Read',
  });
  const zone = zones.find((z) => (z.name ?? domain).toLowerCase() === domain);
  if (!zone) {
    throw new AppError('CLOUDFLARE_ZONE_NOT_FOUND', 'The domain is not managed by this account', {
      domain,
    });
  }
  const zoneId = zone.id;
  const accountId = zone.account.id;

  // DNS conflicts, checked before any tunnel is created.
  const records = await client.request(
    'GET',
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}`,
    { schema: dnsRecordsSchema, permission: 'DNS:Edit' },
  );
  const target = (id: string) => `${id}.cfargotunnel.com`;
  const isOurs = (r: (typeof records)[number], tunnelId: string | undefined) =>
    tunnelId !== undefined && r.type === 'CNAME' && r.content?.toLowerCase() === target(tunnelId);
  const foreign = records.find((r) => !isOurs(r, stored?.tunnelId));
  if (foreign) {
    throw new AppError('CLOUDFLARE_RECORD_EXISTS', 'A DNS record already exists for the hostname', {
      hostname,
      type: foreign.type,
    });
  }

  // One tunnel per instance: reuse it so the tunnel token does not change with the domain.
  let tunnelId: string | undefined;
  if (stored && stored.accountId === accountId) {
    const existing = await client.requestOrNull(
      'GET',
      `/accounts/${accountId}/cfd_tunnel/${stored.tunnelId}`,
      { schema: tunnelSchema, permission: 'Cloudflare Tunnel:Edit' },
    );
    if (existing && !existing.deleted_at) tunnelId = existing.id;
  }
  if (!tunnelId) {
    const created = await client.request('POST', `/accounts/${accountId}/cfd_tunnel`, {
      body: { name: `easysend-${randomBytes(4).toString('hex')}`, config_src: 'cloudflare' },
      schema: tunnelSchema,
      permission: 'Cloudflare Tunnel:Edit',
    });
    tunnelId = created.id;
    // Remember the new tunnel right away (`configuredAt: 0` = not finished): if a later step
    // fails, the retry reuses it instead of leaving an orphan behind.
    ctx.settings.set('tunnel', { hostname, tunnelId, accountId, zoneId, configuredAt: 0 });
  }

  await client.request('PUT', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
    body: {
      config: {
        ingress: [{ hostname, service: INGRESS_SERVICE }, { service: 'http_status:404' }],
      },
    },
    schema: anySchema,
    permission: 'Cloudflare Tunnel:Edit',
  });

  // The CNAME is skipped when the correct one is already there (retry or same hostname).
  if (!records.some((r) => isOurs(r, tunnelId))) {
    try {
      await client.request('POST', `/zones/${zoneId}/dns_records`, {
        body: {
          type: 'CNAME',
          name: hostname,
          content: target(tunnelId),
          proxied: true,
          comment: 'EasySend tunnel',
        },
        schema: anySchema,
        permission: 'DNS:Edit',
      });
    } catch (error) {
      const codes = error instanceof AppError ? error.details?.codes : undefined;
      if (
        error instanceof AppError &&
        error.code === 'CLOUDFLARE_API_ERROR' &&
        Array.isArray(codes) &&
        codes.some((c) => RECORD_EXISTS_CODES.has(c as number))
      ) {
        throw new AppError(
          'CLOUDFLARE_RECORD_EXISTS',
          'A DNS record already exists for the hostname',
          { hostname, type: 'CNAME' },
        );
      }
      throw error;
    }
  }

  const tunnelToken = await client.request(
    'GET',
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`,
    { schema: tokenSchema, permission: 'Cloudflare Tunnel:Edit' },
  );
  await writeTokenFile(ctx.config.sharedDir, tunnelToken);

  ctx.settings.set('tunnel', {
    hostname,
    tunnelId,
    accountId,
    zoneId,
    configuredAt: nowSeconds(ctx.clock),
  });
  const publicUrl = `https://${hostname}`;
  ctx.settings.set('public_url', publicUrl);
  return { hostname, publicUrl, tunnelId };
}
