import { endpoints, type EndpointDef } from '@easysend/shared/contract';
import type { z } from 'zod';
import { request, type QueryValue } from './client';

const byId = new Map<string, EndpointDef>(endpoints.map((endpoint) => [endpoint.id, endpoint]));

/** Zod input type of a request schema (defaults optional), for request parameters. */
export type In<S extends z.ZodType> = z.input<S>;

export interface CallInput {
  params?: Record<string, string | number>;
  query?: Record<string, QueryValue>;
  body?: unknown;
  raw?: { body: Blob; contentType: string };
  skipAuthRedirect?: boolean;
  signal?: AbortSignal | undefined;
}

/**
 * Binds the endpoint modules to the shared contract registry: method, path and response schema
 * come from `endpoints`, so a module can never drift from the API. `ids` is the list of
 * endpoint ids the module wraps (checked by `contract.test.ts`).
 */
export function createApi<Id extends string>(ids: readonly Id[]) {
  return {
    ids,
    /** The caller states `T`, which must match the endpoint's response schema. */
    call<T = void>(id: Id, input: CallInput = {}): Promise<T> {
      const def = byId.get(id);
      if (!def) throw new Error(`Unknown endpoint id: ${id}`);
      return request<T>({
        method: def.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path: def.path,
        ...input,
        schema: def.response.kind === 'json' ? (def.response.schema as z.ZodType<T>) : undefined,
      });
    },
  };
}
