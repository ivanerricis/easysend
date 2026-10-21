---
name: drizzle-migration
description: Change the EasySend database schema (Drizzle + SQLite) and ship the migration safely. Use when adding or changing a table, column or index in apps/api/src/db/schema, or when a feature needs new persisted data.
---

# Drizzle migration (EasySend)

The database is SQLite in WAL mode with Drizzle ORM 0.45 and better-sqlite3. Migrations run at API
startup; before any pending migration on a non-empty database the API takes an online backup with
`sqlite.backup()` (last 5 kept, `app-pre-*.sqlite` in `/data/db/backups`). Read CLAUDE.md
"Decisioni" first.

## Steps

1. **Edit the schema** in `apps/api/src/db/schema/<area>.ts` (tables are re-exported by
   `schema/index.ts`). Conventions: random text ids, timestamps as Unix **seconds** (integer),
   `foreign_keys=ON` (choose `onDelete` explicitly: `cascade` for children, `restrict` for owners),
   indexes on every column used for lookups. Shared helpers are in `schema/_helpers.ts`.
2. **Generate the migration**: `pnpm db:generate`. Inspect the new `apps/api/drizzle/NNNN_*.sql`:
   - SQLite cannot alter most column properties: Drizzle rebuilds the table (`__new_` copy). Check
     that data is copied, defaults make sense for existing rows, and foreign keys still hold.
   - A `NOT NULL` column on an existing table needs a default or a data backfill in the same file.
   - Never edit an already released migration; add a new one.
3. **Data migrations**: if existing rows must change, add the SQL to the generated file (it runs in
   the same transaction) and keep it idempotent where possible.
4. **Shared types**: if the data reaches the API contract, update the Zod schemas in
   `packages/shared/src/schemas` and follow the `api-endpoint` skill (run `pnpm api:docs`).
5. **Tests** (`apps/api/test/migrate.test.ts` shows the patterns):
   - a migration test that starts from the previous schema with rows in the touched tables and
     checks the data after migrating (see "applies 0001 on a database that already has 0000");
   - the backup-before-migration behaviour must still hold;
   - service/route tests for the new fields.
6. **Checks**: `pnpm db:check` (fails if schema and committed migrations differ), `pnpm typecheck`,
   `pnpm --filter @easysend/api test`, then `pnpm test:e2e` if user flows are affected.
7. **Commit** the schema change and the migration (+ `meta/` journal and snapshot) together:
   `feat(api): ...` or `fix(api): ...`. Mention data migrations in the PR summary.

## Don'ts

- No `node:sqlite`, no raw `ALTER TABLE` outside generated migrations.
- No destructive change (drop column/table) without a backup note and an explicit user decision.
- Keep `used_bytes` and quota rules intact (see "Decisioni").
