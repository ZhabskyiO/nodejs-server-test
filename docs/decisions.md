# Decisions

Choices in this codebase that look odd until you know why. Each one has bitten someone or
prevents a specific failure — change them deliberately, not incidentally.

## Structure

**Static module registry, not `@fastify/autoload`.**
`src/modules/index.ts` lists plugins by hand. Native dynamic `import()` of a `.ts` file
resolves differently under tsx, tsc-built output, and vitest; autoload works in one and
fails in the others. A new module is one line in the registry.

**`.js` extensions on relative imports — except in `src/db/schema/`.**
Pure ESM requires the extension. drizzle-kit loads the schema through esbuild-register
(CJS), which cannot map a `.js` specifier back to `.ts`, so those files are extensionless
and `pnpm db:generate` fails with `MODULE_NOT_FOUND` if someone "fixes" them.

**`buildApp()` exported separately from `server.ts`.**
Tests get the whole real app — plugins, error handler, serialization — via `app.inject()`
without binding a port or racing on one. `server.ts` is only `listen()` plus signal
handling.

**The error handler is registered before the modules.**
Fastify plugins are encapsulated, and a child inherits the handler present at registration
time. Registering `setErrorHandler` after the module loop would leave every module route
on Fastify's default handler, and the envelope would silently apply to nothing.

**Mocks live in `src/adapters/mocks.ts`, not under `test/`.**
They implement the same ports as the real adapters and are typechecked against them by the
normal build. A drifting mock is a compile error rather than a green test.

## HTTP

**`/health/ready` returns 503, not 500.**
Orchestrators read 503 as "not ready yet" and keep the pod in rotation-pending; a 500 reads
as a crash. The driver error is logged, never returned.

**The rate limit is skipped under `NODE_ENV=test`.**
Suites fire hundreds of `inject()` calls; 120/min would make them flaky and order-dependent.
Everything else — helmet, cors, validation, the error handler — stays on in tests, because
those are what the tests are checking.

**Response serialization failures become a generic 500.**
If a handler returns something its `response` schema rejects, the half-built object must not
reach the client. The failure is logged with the real detail and the client gets
`internal_error`.

**Unknown errors return a fixed message.**
Anything that is not an `AppError` or a zod error yields `{ code: 'internal_error',
message: 'Internal error' }`. A Postgres error string can contain a connection URL,
including credentials.

**A non-uuid `:id` is 422, not 404.**
`IdParams` validates at the edge, so a malformed id never reaches the database. It is a
malformed request, not a missing resource.

**Another workspace's row returns 404, not 403.**
403 confirms the row exists. 404 tells a caller nothing about another tenant.

**`bodyLimit` is pinned to 1 MB.**
Articles cap at 50 000 characters; the default 1 MB is already generous, and stating it
makes the intent explicit rather than inherited.

## Domain

**The slug is never recomputed on rename.**
It is part of the article's public URL. Rewriting it on a title change would break every
existing link. `PATCH` deliberately has no path back to a new slug.

**Slug de-duplication fetches taken prefixes in one query.**
`slugsLike()` returns every slug starting with the base, then the service walks
`base-2 … base-50` in memory. The naive version loops against the database once per
collision. Past 50 attempts it falls back to a timestamp suffix rather than failing the
request.

**`status` is `text` with a default, not a pg enum.**
Adding a state needs no migration. The allowed values are pinned at the edge by
`z.enum(ARTICLE_STATUSES)`, which is where an invalid value would actually arrive.

**Tags are normalized on write, not on read.**
Lowercased, trimmed, de-duplicated, capped at 10 × 32 chars before they hit the column, so
the `tag` filter can be an exact `arrayContains` match instead of something case-folding.

**Comment authors are free text, unrelated to `users`.**
Comments are anonymous in this fixture. `articles.author_id` is a real FK; `comments.author`
is a string.

**Articles delete their comments via `ON DELETE CASCADE`.**
The repository issues one delete. Doing it in application code means two statements that
can half-succeed.

## Data

**Migrations never run on boot.**
An app that migrates on start will, on a bad deploy, migrate from several replicas at once.
`pnpm db:migrate` is an explicit step, and `runMigrations()` is shared with the test harness
so the same code path is exercised by `pnpm test:it`.

**Postgres is on 5433.**
5432 is usually taken by a local Postgres. This is a test fixture; it should not fight for
the default port.

**`articles_ws_slug_uq` is composite.**
Per-tenant uniqueness. A bare unique index on `slug` would let one workspace's article
block another's.

**Index column order mirrors the query.**
`(workspace_id, status, created_at)` is exactly how the default list filters and sorts. An
index in a different order is a different index.

**`updated_at` is bumped in the repository, not by a trigger.**
The bump is visible in the code that performs the write, and the test harness needs no
trigger installed.
