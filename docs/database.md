# Database

Postgres 16 via `docker compose`, on **port 5433** to avoid clashing with a local
Postgres. Drizzle ORM over `postgres-js`. Schema lives in `src/db/schema/`, migrations in
`src/db/migrations/`.

## Tables

```
workspaces ──┬── users ──── articles.author_id
             ├── articles ──── comments.article_id
             └── comments
```

Every FK is `ON DELETE CASCADE`, so deleting a workspace removes everything under it and
deleting an article removes its comments (the articles repository relies on this rather
than deleting comments itself).

### `workspaces`
`id` uuid PK · `name` text · `created_at` timestamptz. The tenancy root.

### `users`
`id` uuid PK · `workspace_id` → workspaces · `email` (unique, **globally** — `users_email_uq`
is not workspace-scoped) · `display_name` · `created_at`. Only referenced as
`articles.author_id`; there is no users endpoint.

### `articles`
`id` · `workspace_id` · `author_id` · `slug` · `title` · `body` · `status` (text, default
`draft`) · `tags` (`text[]`, default `{}`) · `published_at` (nullable) · `created_at` ·
`updated_at`.

Indexes:
- `articles_ws_slug_uq` — **unique** `(workspace_id, slug)`. Per-tenant uniqueness: two
  workspaces may both own `hello-world`.
- `articles_ws_status_created_idx` — `(workspace_id, status, created_at)`, matching the
  default list query (filter workspace + status, sort `created_at desc`).

`status` is `text` with a default rather than a pg enum, so adding a state does not need a
migration. The `tag` filter uses `arrayContains` — no GIN index yet, which is fine at this
size and is the first thing to add if tag filtering ever matters.

### `comments`
`id` · `workspace_id` · `article_id` · `author` (free text — comments are anonymous) ·
`body` · `created_at`. Indexed on `(article_id, created_at)`.

## Tenancy

`workspace_id` is the only thing separating two tenants' data, and it is enforced in
application code — there is no row-level security. The rules:

1. Every domain table carries `workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`.
2. Every repository `select` / `update` / `delete` includes
   `eq(t.<table>.workspaceId, workspaceId)` in its `and(...)`, and takes `workspaceId` as
   its first parameter.
3. Inserts take the tenant from the resolved request context, never from the body. No Zod
   request schema may contain `workspaceId`, `authorId` or `userId`.
4. A child resource re-checks its parent in the same workspace before writing
   (`CommentService.requireArticle()`).
5. Uniqueness that should be per-tenant is a composite index including `workspace_id`.
6. `workspaceId` never appears in a DTO or a response schema.

A row belonging to another workspace comes back as **404**, indistinguishable from a row
that does not exist — that is deliberate.

The `tenancy-auditor` agent in `.claude/agents/` checks all six.

## Schema files

`src/db/schema/` uses **extensionless** relative imports — the single exception to the
repo's `.js` rule. drizzle-kit loads these through esbuild-register (CJS), which cannot
resolve a `.js` specifier back to `.ts`, and `pnpm db:generate` fails with
`MODULE_NOT_FOUND` otherwise.

`src/db/schema.ts` is the barrel: it re-exports every table **and** builds the `schema`
object handed to `drizzle()`. A new table needs both.

Shared columns come from `./schema/_shared`: `createdAt()` and `updatedAt()`, both
timestamptz, `defaultNow().notNull()`. `updated_at` is bumped explicitly by repositories
on update — there is no trigger.

## Migrations

Migrations **never run on boot**. A fresh database without `pnpm db:migrate` fails with
`relation "articles" does not exist`.

```bash
docker compose up -d
pnpm db:generate    # diff schema/ against meta/ → new SQL
pnpm db:migrate     # apply (idempotent)
pnpm db:seed        # default workspace + system user
```

`pnpm db:generate` diffs the schema against the snapshot in `src/db/migrations/meta/`.
Commit the generated `.sql` **and** the updated `meta/` together — the snapshot is how the
next diff knows its starting point.

Things the generator gets wrong on its own:

- **`NOT NULL` on a populated table** fails without a default. Either add `.default(...)`,
  or split into add-nullable → backfill → enforce.
- **Renames** are indistinguishable from drop-plus-add, and drizzle-kit's interactive
  prompt is not available here. Generate, then hand-edit to `ALTER TABLE … RENAME COLUMN …`
  before it runs anywhere real.

Always read the emitted SQL before committing.

`runMigrations(url)` is exported from `src/db/migrate.ts` and reused by the Testcontainers
harness, so `pnpm test:it` proves the migration applies from empty.

## Seed

`pnpm db:seed` inserts the fixed workspace and user that `LocalAuthProvider` hands to
every request:

- workspace `00000000-0000-4000-8000-000000000001`
- user `00000000-0000-4000-8000-000000000002` (`system@example.com`)

Both `onConflictDoNothing()`, so re-running is a no-op. The IDs are constants in
`src/adapters/auth/local.ts` — the seed, the tests and the running app all import them
from there.

## Connections

`createDb(url, { max })` returns `{ db, sql, close }`. The app creates one handle with
`max: 10` and closes it on Fastify's `onClose`; the test harness uses `max: 5` per suite.
A `db` passed into `buildApp()` is owned by the caller and is **not** closed by the app.
