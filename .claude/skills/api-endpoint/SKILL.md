---
name: api-endpoint
description: Add or change an EasySend API endpoint end to end - shared Zod schemas, contract registry, Express route with guards, web client binding, docs/api.md and tests. Use for any new or modified /api route.
---

# API endpoint with the shared contract (EasySend)

Every endpoint is declared once in the contract registry and everything else derives from it:
validation, auth and CSRF guards, response filtering (`sendJson`), the web client and `docs/api.md`.
Read CLAUDE.md "Decisioni" (error format, 404 for non-owners, auth levels, timestamps in seconds).
A complete recent example: `admin.updates` (contract entry, `apps/api/src/routes/admin-updates.ts`,
`apps/web/src/lib/api/admin.ts` `getUpdateStatus`).

## Steps

1. **Schemas** in `packages/shared/src/schemas/<area>.ts`: request (`params`, `query`, `body`) and
   response with Zod 4. Export the inferred types. Responses list only the fields the client may
   see (`sendJson` strips everything else, also in production). Add schema tests if there is logic
   (defaults, refinements).
2. **Contract entry** in `packages/shared/src/contract/endpoints.ts` with `defineEndpoint({...})`:
   id, tag, method, path, summary, auth, and as needed csrf, rateLimit, params, query, body,
   response, errors, notes. `auth` is one of `public | mfa-pending | session | admin | setup`. Use stable error
   codes; new codes need IT/EN translations in the web `errors` namespace (a test enforces it).
3. **Route** in `apps/api/src/routes/<area>.ts`:
   `router.<method>(path, ...endpointGuards(ctx.csrf, '<id>'), handler)` and reply with
   `sendJson(res, '<id>', status, body)`. Read inputs with `validQuery` / validated params/body.
   Authorization on every resource: non-owners get 404, never 403. Rate limits through the existing
   limiters (`assertNotLimited`), thresholds in the area's `policy.ts`. Audit rows for admin and
   security-relevant actions, never with secrets; IPs only as `ipHash`.
   Mount the router in `apps/api/src/app.ts` if it is new.
4. **Docs**: `pnpm api:docs` and commit `docs/api.md` (`pnpm api:docs:check` runs in CI).
5. **Web client**: a function in `apps/web/src/lib/api/<area>.ts` calling
   `api.call('<id>', { params, query, body })`, registered in `createApi` so
   `contract.test.ts` sees it. UI uses TanStack Query; i18n keys in both `it` and `en`.
6. **Tests**:
   - Supertest in `apps/api/test/<area>.test.ts`: happy path, validation errors (400
     `VALIDATION_ERROR`), not found / other user's resource (404), rate limit if any.
   - `apps/api/test/security-matrix.test.ts`: add the id to the covered list so auth level and CSRF
     are asserted (the "scope" test fails for unmounted or uncovered endpoints).
   - Web unit test for the UI using the endpoint.
7. **Checks**: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm api:docs:check`; `pnpm test:e2e`
   when a user flow changes.
