# Architecture

Fastify 5 + Drizzle over Postgres 16, pure ESM, one process. The shape is deliberately
that of a larger production service — the value of this repo is the structure, not the
feature set.

## Rings

```
routes.ts (transport)  →  service.ts (application)  →  repository.ts (persistence)  →  db
                       ↘  src/adapters/** (ports)   ↗
                          src/platform/container.ts wires everything
```

Imports point inward. A file depends on its own ring and the one to its right, never
leftward — a repository knows nothing about HTTP, a service knows nothing about Fastify's
`request`, and neither reads `process.env`.

| Ring | File | May do | Must not |
|---|---|---|---|
| Transport | `src/modules/<name>/routes.ts` | declare Zod `schema`, call `getContext()`, delegate, set status | business rules, SQL, hand-built error bodies |
| Application | `src/modules/<name>/service.ts` | orchestrate, enforce rules, throw domain errors | touch a table directly, import an SDK |
| Persistence | `src/modules/<name>/repository.ts` | own exactly one table | throw domain errors, know about HTTP |
| Ports | `src/adapters/ports.ts` + `src/adapters/<kind>/` | wrap anything external | be constructed outside the container |
| Composition | `src/platform/container.ts` | construct adapters | contain logic |
| Pure | `src/modules/<name>/helpers.ts` | transform, map rows to DTOs | any I/O, anything `async` |

## Request lifecycle

`POST /articles` end to end:

1. **Fastify routing.** The module plugin registered from `src/modules/index.ts` matches
   the path.
2. **Validation.** `validatorCompiler` from `fastify-type-provider-zod` runs
   `schema.body` / `schema.params` / `schema.querystring`. A failure never reaches the
   handler — it throws, and the error handler renders **422**. This is why hermetic tests
   can run against a database that throws on every call.
3. **Handler.** `getContext(app.container, req)` resolves `{ workspaceId, userId }` from
   the `AuthProvider` port. The handler passes `workspaceId` into the service as the first
   argument and does nothing else of substance.
4. **Service.** Business rules run here — slug de-duplication, the draft → published
   transition, the "already published" conflict. Missing or invalid state is a `throw`,
   never a returned error object.
5. **Repository.** One Drizzle query, always with `eq(table.workspaceId, workspaceId)` in
   its `and(...)`. Returns a row or `undefined`.
6. **Port effects.** `container.notifier.articlePublished(...)` fires after the write
   succeeds. Services reach the outside world only this way.
7. **Response.** The handler maps the row through `toArticleDto()` and returns it;
   `serializerCompiler` validates the result against `schema.response[status]`. A field
   the DTO returns but the schema omits is **silently dropped** — that is what keeps
   `workspaceId` off the wire.

## Composition root

`Container` (`src/platform/container.ts`) is the only place that constructs adapters. It
holds `config` and `db`, and exposes ports as lazy getters:

```ts
get notifier(): Notifier {
  this._notifier ??= this.overrides.notifier ?? new ConsoleNotifier();
  return this._notifier;
}
```

`ContainerOverrides` is the test seam: `buildApp({ overrides: { notifier } })` swaps an
implementation without touching a service. Adding a capability means four edits — an
interface in `ports.ts`, an implementation in `adapters/<kind>/`, a getter and an
overrides field in the container.

The container is decorated onto the Fastify instance (`app.container`), so every route
reaches it without an import.

## Registration order in `buildApp()`

`src/app.ts` builds the app in an order that matters:

1. Zod validator + serializer compilers.
2. `app.decorate('container', …)` — routes need it at registration time.
3. Security plugins: `helmet`, `cors` (origin pinned to `config.webOrigin`), and
   `rate-limit` **skipped under `NODE_ENV=test`** so suites can hammer `inject()`.
4. Health routes, both with `rateLimit: false`.
5. `setErrorHandler` — **before** modules, so each encapsulated module plugin inherits it.
   Registering it after would leave module routes with Fastify's default handler.
6. Feature modules from the static registry.

`buildApp()` is exported and takes `{ config, db, overrides }`, so tests get the real app
without binding a port. `src/server.ts` is only `listen()` plus SIGTERM/SIGINT shutdown.

## Errors

One taxonomy (`src/platform/errors.ts`), one handler (`src/app.ts`), one envelope:

```json
{ "error": { "code": "conflict", "message": "Article is already published", "details": { "articleId": "…" } } }
```

`AppError` carries `code`, `statusCode` and optional `details`; `NotFoundError` (404),
`ValidationError` (422), `ConflictError` (409) and `ConfigError` (500) subclass it. The
handler also recognises zod validation failures, response **serialization** failures (
logged, returned as a generic 500 — a half-built object must never reach a client), and
anything unknown, which becomes `internal_error` with a fixed message. Driver text,
stacks and SQL never reach the client.

## Multi-tenancy

Every domain row hangs off a workspace, and isolation is enforced by convention rather
than row-level security — so the convention has to hold in every query. The tenant comes
from the `AuthProvider` port, never from the request body. `LocalAuthProvider` currently
returns fixed IDs (`DEFAULT_WORKSPACE_ID` / `SYSTEM_USER_ID`) because this fixture has no
real auth; that is a stub behind a port, not permission to skip scoping. See
[database.md](database.md#tenancy).

## Module anatomy

```
src/modules/articles/
  routes.ts        transport: Zod schemas + handlers
  service.ts       rules, orchestration, domain errors
  repository.ts    the only file touching the `articles` table
  helpers.ts       pure: slugify, normalizeTags, toArticleDto
  constants.ts     status union + every length/count bound
```

`comments` is the same minus `helpers.ts`/`constants.ts` (its DTO lives in `service.ts` —
small enough not to warrant the split). Shared transport pieces are in
`src/modules/_shared/`: `IdParams`, `PageQuery`, `paginated()`, `ApiError`, `getContext()`.

Cross-module reads go through the owning module's repository class — `CommentService`
constructs an `ArticleRepository` to verify the parent article exists *in this workspace*.
It never queries `articles` itself.

## Conventions that have a reason

- **Static module registry**, not `@fastify/autoload`: dynamic `import()` of `.ts` is not
  portable across tsx / tsc / vitest.
- **`.js` extensions on relative imports** — required by pure ESM. The exception is
  `src/db/schema.ts` and `src/db/schema/**`, which are extensionless because drizzle-kit
  loads them through esbuild-register (CJS) and cannot map `.js` back to `.ts`.
- **Migrations never run on boot.** `pnpm db:migrate` is explicit, in CI and locally.

More of the same in [decisions.md](decisions.md); the enforceable rules are in
[CLAUDE.md](../CLAUDE.md).
