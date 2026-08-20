---
name: db-schema-change
description: Change the Postgres schema in this repo — add or alter a table, column, index, or constraint — and ship the Drizzle migration with it. Use for "add a column", "add an index", "new table", "make X nullable", or any drizzle-kit / pnpm db:generate / migration question.
---

# Schema changes and migrations

Drizzle-kit generates SQL by diffing `src/db/schema.ts` against the snapshot in
`src/db/migrations/meta/`. Migrations never run on boot — they are an explicit step, in
CI and locally.

## The loop

```bash
docker compose up -d      # Postgres 16 on localhost:5433
pnpm db:generate          # diff schema → new SQL in src/db/migrations/
pnpm db:migrate           # apply to the local DB
pnpm test:it              # DB-backed suites against the new shape
```

Commit the generated `.sql` **and** the updated `meta/` snapshot together. The snapshot is
how the next diff knows where it started — dropping it produces a migration that tries to
recreate everything.

## Writing the schema

Files under `src/db/schema/` use **extensionless** relative imports. This is the one
exception to the repo's `.js` rule: drizzle-kit loads them through esbuild-register (CJS),
which cannot resolve a `.js` specifier back to `.ts`, and `pnpm db:generate` fails with
`MODULE_NOT_FOUND`. Everything outside this directory keeps `.js`.

A new table needs, without exception:

```ts
workspaceId: uuid('workspace_id')
  .references(() => workspaces.id, { onDelete: 'cascade' })
  .notNull(),
```

plus `createdAt()` / `updatedAt()` from `./_shared` for timestamptz columns, and an entry
in the barrel `src/db/schema.ts` — the `export *` line *and* the `schema` object passed to
`drizzle()`.

Uniqueness is per-tenant: `uniqueIndex('things_ws_slug_uq').on(t.workspaceId, t.slug)`. A
bare unique index on a domain column collides across tenants.

Index anything you filter or sort by. The composite order mirrors the query —
`articles_ws_status_created_idx` is `(workspaceId, status, createdAt)` because the default
list filters workspace + status and sorts by `createdAt desc`. Adding a filter to a
repository without an index is how this table gets slow.

Status columns stay `text` with a default rather than a pg enum, so adding a state does
not need a migration.

## Adding a column to a populated table

`ALTER TABLE … ADD COLUMN … NOT NULL` fails against existing rows unless it has a default.
Either give the column `.default(...)` in the schema, or split the change: add nullable,
backfill, then a second migration to enforce `NOT NULL`. Review the generated SQL before
committing — drizzle-kit will happily emit a statement that cannot apply.

## Renames and drops

The diff cannot tell a rename from a drop-plus-add, and drizzle-kit's interactive prompt
is not available in this environment. For a rename, generate, then hand-edit the emitted
SQL to `ALTER TABLE … RENAME COLUMN …` before it ever runs anywhere real. Dropping a
column that a response schema still declares breaks serialization — update `helpers.ts`
and the Zod `*Response` in the same change.

## After the migration

Rows are typed by inference (`typeof t.things.$inferSelect`), so a column change ripples
into repositories, DTO mappers and response schemas. `pnpm typecheck` finds the first two;
the response schema is not type-checked against the DTO, so read it yourself.

```bash
pnpm typecheck && pnpm test
```

`test/helpers/pg.ts` runs migrations against a fresh Testcontainers Postgres, so
`pnpm test:it` is the real proof the migration applies from empty.
