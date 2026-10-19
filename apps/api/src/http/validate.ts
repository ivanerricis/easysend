import type { RequestHandler, Response } from 'express';
import { endpoints, type EndpointDef } from '@easysend/shared/contract';

/** Parsed request input stored in `req.valid` by `validate(endpointId)`. */
export interface ValidatedInput {
  params: unknown;
  query: unknown;
  body: unknown;
}

const registry = new Map<string, EndpointDef>();
for (const endpoint of endpoints) registry.set(endpoint.id, endpoint);

/** Endpoint definition by id. Throws on an unknown id, so a typo fails at startup, not at runtime. */
export function getEndpoint(id: string): EndpointDef {
  const endpoint = registry.get(id);
  if (!endpoint) throw new Error(`Unknown endpoint id: ${id}`);
  return endpoint;
}

/**
 * Validates params, query and body with the schemas of the shared registry. Failures become
 * 400 VALIDATION_ERROR through the error handler. Parsed values land in `req.valid`; read them
 * with `validBody` / `validQuery` / `validParams`.
 */
export function validate(id: string): RequestHandler {
  const endpoint = getEndpoint(id); // fail fast when the handler is built
  return (req, _res, next) => {
    try {
      req.valid = {
        params: endpoint.params ? endpoint.params.parse(req.params) : undefined,
        query: endpoint.query ? endpoint.query.parse(req.query) : undefined,
        body: endpoint.body ? endpoint.body.parse(req.body) : undefined,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Typed accessors: the caller states the type, which must match the endpoint schema. */
export const validBody = <T>(req: { valid?: ValidatedInput }): T => req.valid?.body as T;
export const validQuery = <T>(req: { valid?: ValidatedInput }): T => req.valid?.query as T;
export const validParams = <T>(req: { valid?: ValidatedInput }): T => req.valid?.params as T;

/**
 * Sends a JSON response after parsing the payload with the endpoint's response schema. Always
 * on (also in production): the parse drops fields the schema does not list, so a handler can
 * never leak an extra column (password hash, TOTP secret) and the contract stays true.
 * A mismatch is a server bug and surfaces as 500 INTERNAL_ERROR.
 */
export function sendJson(
  res: Response,
  endpointId: string,
  status: number,
  payload: unknown,
): void {
  const endpoint = getEndpoint(endpointId);
  const { response } = endpoint;
  if (response.kind !== 'json' || !response.schema) {
    throw new Error(`Endpoint ${endpointId} does not have a JSON response`);
  }
  const parsed = response.schema.safeParse(payload);
  if (!parsed.success) {
    // A plain Error: the handler logs it and answers a generic 500 without internals.
    throw new Error(`Response does not match the contract of ${endpointId}`);
  }
  res.status(status).json(parsed.data);
}
