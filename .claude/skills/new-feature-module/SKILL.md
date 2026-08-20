---
name: new-feature-module
description: Scaffold a new feature module (routes + service + repository + helpers + constants + schema + migration + tests) in this Fastify/Drizzle API. Use when asked to add a new resource, entity, or domain concept — "add a tags module", "add likes", "new endpoint group for X" — anything that needs its own table or its own service.
---

# Adding a feature module

A module is a folder under `src/modules/<name>/` plus a table under `src/db/schema/`.
Build it in dependency order — schema, repository, service, routes, registry, tests — so
each layer compiles against something that already exists.

## 1. Table — `src/db/schema/<name>.ts`

Extensionless relative imports in this directory only (drizzle-kit loads it through
esbuild-register and cannot map `.js` → `.ts`).

```ts
import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { createdAt, updatedAt } from './_shared';

export const things = pgTable(
  'things',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('things_ws_created_idx').on(t.workspaceId, t.createdAt)],
);
```

Every domain table is workspace-scoped and cascades from `workspaces`. Uniqueness that
should be per-tenant is a composite index including `workspaceId` (`articles_ws_slug_uq`
is the model). Then export it from the barrel `src/db/schema.ts` — both the `export *`
line and the `schema` object — and run `pnpm db:generate`, committing the SQL and `meta/`.

## 2. `constants.ts`

Status unions (`as const` + derived type) and every length/count bound. Routes import
these instead of inlining numbers.

## 3. `repository.ts`

The only file allowed to touch this table. Constructor takes `Db`. Export
`export type ThingRow = typeof t.things.$inferSelect;` and explicit `Insert*` / `Update*`
interfaces. **Every** read, update and delete carries `workspaceId` as its first argument
and `eq(t.things.workspaceId, workspaceId)` inside `and(...)`. If list and count share
filters, build the WHERE once in a private `listWhere()` so the two cannot diverge.
Mutations `.returning()` and hand back `Row | undefined` (or `boolean` for deletes) — the
repository never throws domain errors.

## 4. `helpers.ts`

Pure transforms only: normalizers, and the `toThingDto(row)` mapper. No imports from the
db client or a repository beyond the row *type*. Never copy `workspaceId` into the DTO.
Dates go out as `row.createdAt.toISOString()`, nullable ones as `?.toISOString() ?? null`.

## 5. `service.ts`

Takes the `Container` in its constructor, builds its repositories from `container.db`,
and reaches anything external through container ports (`container.notifier`,
`container.auth`) — never an SDK, never `process.env`. This is where domain errors are
thrown:

```ts
const row = await this.repo.getById(workspaceId, id);
if (!row) throw new NotFoundError('Thing not found');
```

`NotFoundError` for missing, `ConflictError` for an invalid state transition,
`ValidationError` for a rule Zod cannot express. Need another module's data? Import that
module's repository class (as `CommentService` imports `ArticleRepository`) rather than
querying its table.

## 6. `routes.ts`

```ts
export default async function thingsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ThingService(app.container);

  app.post(
    '/things',
    { schema: { body: CreateThingBody, response: { 201: ThingResponse, 422: ApiError } } },
    async (req, reply) => {
      const { workspaceId, userId } = await getContext(app.container, req);
      const thing = await service.create(workspaceId, userId, req.body);
      reply.status(201);
      return toThingDto(thing);
    },
  );
}
```

Parse, delegate, set the status code — nothing else. Reuse `IdParams`, `PageQuery`,
`paginated()`, `ApiError` from `../_shared/schemas.js`. Declare every status the handler
can produce in the `response` map, error ones included. Never `Schema.parse(req.body)`.

## 7. Register it

Add the plugin to the static registry in `src/modules/index.ts`. There is no autoload.

## 8. Tests

One hermetic suite for validation/error paths (`test/<name>.test.ts`, runs with no DB)
and one DB-backed suite (`test/<name>.it.test.ts`, Testcontainers). The filename suffix
picks the CI lane. See the `api-tests` skill for the harness.

## Before you hand it back

```bash
pnpm typecheck && pnpm test
```

Relative imports outside `src/db/schema/` end in `.js`. If the module added an external
dependency, it belongs behind a port in `src/adapters/ports.ts`, wired in
`src/platform/container.ts`, with a matching `ContainerOverrides` field.
