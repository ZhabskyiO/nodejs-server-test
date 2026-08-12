# nodejs-server-test

Back-end repo with dummy API endpoints for testing purposes. A small Fastify + Drizzle CRUD service
over `articles` and `comments`, structured the same way as a real production API so pull requests
against it exercise realistic review rules.

**Stack:** Node 22 · Fastify 5 · Zod (`fastify-type-provider-zod`) · Drizzle ORM · Postgres 16 ·
Vitest (+ Testcontainers) · pure ESM · pnpm.

## Getting started

```bash
nvm use                 # Node 22
pnpm install
docker compose up -d    # Postgres 16 on localhost:5433
cp .env.example .env
pnpm db:migrate         # apply migrations (they do NOT run on boot)
pnpm db:seed            # default workspace + system user
pnpm dev                # http://localhost:3005
```

| Script | Does |
|---|---|
| `pnpm dev` | `tsx watch src/server.ts` |
| `pnpm build` / `pnpm start` | `tsc` → `node dist/server.js` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | unit + integration |
| `pnpm test:unit` | DB-free suites only |
| `pnpm test:it` | DB-backed suites (needs Docker) |
| `pnpm db:generate` | regenerate migrations from `src/db/schema.ts` |

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | liveness |
| `GET` | `/health/ready` | `SELECT 1`; **503** when the DB is unreachable |
| `POST` | `/articles` | **201**; `{ title, body, tags?, status? }`, slug generated + de-duplicated |
| `GET` | `/articles` | `?status=&tag=&q=&page=&limit=` → `{ items, page, limit, total }` |
| `GET` | `/articles/:id` | **404** if missing |
| `PATCH` | `/articles/:id` | partial; at least one of `title`/`body`/`tags`; slug is never rewritten |
| `POST` | `/articles/:id/publish` | draft → published; **409** if already published |
| `DELETE` | `/articles/:id` | `{ deleted: id }`; comments cascade |
| `POST` | `/articles/:id/comments` | **201**; `{ author, body }` |
| `GET` | `/articles/:id/comments` | `?page=&limit=` → paginated, newest first |
| `DELETE` | `/comments/:id` | `{ deleted: id }` |

Errors always come back as `{ "error": { "code", "message", "details"? } }` —
`validation_error` (422), `not_found` (404), `conflict` (409), `internal_error` (500).

```bash
curl -s -XPOST localhost:3005/articles -H 'content-type: application/json' \
  -d '{"title":"Hello","body":"world","tags":["node"]}'
```

## Scheduled jobs

Registered in `src/platform/jobs.ts` and armed by `buildApp()` through the `Scheduler` port
(`node-cron` behind `src/adapters/scheduler/node-cron.ts`). Jobs are cross-tenant: each run fans out
over every workspace and calls the service once per workspace, so one failing tenant doesn't skip the
rest.

| Job | Default schedule | Does |
|---|---|---|
| `stale-draft-digest` | `0 3 * * *` | Reports drafts untouched for `STALE_DRAFT_AFTER_DAYS` through the `Notifier` port. Read-only — it never changes an article. |

| Env | Default | Meaning |
|---|---|---|
| `JOBS_ENABLED` | `true` | Master switch. Forced **off** under `NODE_ENV=test` so a suite can't leave a live timer behind. |
| `STALE_DRAFT_CRON` | *(empty)* | Overrides the registered expression. Empty falls back to `CRON_SCHEDULES` in `src/platform/jobs.ts`. Validated at startup. |
| `STALE_DRAFT_AFTER_DAYS` | `14` | How idle a draft must be to be reported. |
| `STALE_DRAFT_LIMIT` | `50` | Per-workspace cap on one digest. |

Each job has two triggers and one implementation. In-process cron covers a long-lived single replica;
the scheduled workflow (`.github/workflows/stale-draft-digest.yml`, same expression) covers the rest —
API scaled to zero, or several replicas, where in-process cron fires once per replica. Both call
`runStaleDraftDigest()`.

```bash
# watch the in-process cron fire, without waiting for 03:00
STALE_DRAFT_CRON='* * * * *' STALE_DRAFT_AFTER_DAYS=0 pnpm dev

# or run it once and exit — this is what the workflow invokes
pnpm job:stale-drafts
```

## Layout

```
src/
  server.ts              # listen + graceful shutdown
  app.ts                 # buildApp() — exported so tests can use app.inject()
  jobs/<name>.ts         # one-shot job entrypoints (scheduled workflows call these)
  platform/              # config, DI container, error taxonomy, job registry
  adapters/              # ports + implementations (auth, notifier, scheduler) + test mocks
  db/                    # drizzle schema, client, migrations, seed
  modules/<name>/        # routes → service → repository (+ helpers, constants)
test/                    # *.test.ts hermetic · *.it.test.ts DB-backed
```

Conventions the code follows (and PRs are checked against) are in [CLAUDE.md](CLAUDE.md).
