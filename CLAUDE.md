# CLAUDE.md

Fastify 5 + Drizzle CRUD API over `articles` and `comments`. Small on purpose: it exists as a
review target, so the conventions below matter more than the feature set.

## Run it

```bash
nvm use                 # Node 22
pnpm install
docker compose up -d    # Postgres 16 on localhost:5433
cp .env.example .env
pnpm db:migrate         # migrations never run on boot
pnpm db:seed            # default workspace + system user
pnpm dev                # http://localhost:3005
```

`pnpm typecheck` · `pnpm test` (both lanes) · `pnpm test:unit` (DB-free) · `pnpm test:it` (Docker).

## Layering — imports point inward

```
routes (transport)  →  service (application)  →  repository (persistence)  →  db
                    ↘  adapters (ports)  ↗
                       platform/container.ts wires everything
```

| Ring | Lives in | May do |
|---|---|---|
| Transport | `src/modules/<name>/routes.ts` | parse + validate, set status codes, delegate |
| Application | `src/modules/<name>/service.ts` | business rules, orchestration, throws domain errors |
| Persistence | `src/modules/<name>/repository.ts` | the only file allowed to touch its table |
| Ports/Adapters | `src/adapters/**` | wrap anything external |
| Composition root | `src/platform/container.ts` | the only place that constructs adapters |
| Pure | `src/modules/<name>/helpers.ts` | no I/O — unit-testable transforms |

## Hard rules

1. **Validate at the edge.** Routes declare Zod `schema: { body, params, querystring, response }`
   and call `app.withTypeProvider<ZodTypeProvider>()`. Never `Schema.parse(req.body)` in a handler.
2. **Scope every query by `workspaceId`.** Handlers get it from `getContext(app.container, req)`;
   repositories `and(eq(table.workspaceId, workspaceId), …)` on every read, update and delete.
3. **Throw, don't build errors.** `throw new NotFoundError('Article not found')`. The single
   `setErrorHandler` in `src/app.ts` renders `{ error: { code, message, details } }`. Unknown
   failures return a generic message — internal detail must not reach the client.
4. **No SDK or `process.env` in a service.** New external dependency → a port in
   `src/adapters/ports.ts`, an implementation in `src/adapters/<kind>/`, wired in the container.
   Config comes from `AppConfig` only.
5. **Register modules statically** in `src/modules/index.ts` (no autoload — dynamic `import()` of
   `.ts` is not portable across tsx / tsc / vitest).
6. **ESM with `.js` extensions** on relative imports. Exception: `src/db/schema.ts` and everything
   under `src/db/schema/` use extensionless imports, because drizzle-kit loads them through
   esbuild-register (CJS) and cannot resolve `.js` → `.ts`.
7. **Schema changes ship a migration.** `pnpm db:generate`, commit the SQL and `meta/`.
8. **Test filename picks the CI lane.** `*.it.test.ts` = DB-backed (Testcontainers, self-skips
   without Docker); anything else must run with no DB.
