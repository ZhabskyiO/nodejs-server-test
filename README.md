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

## Layout

```
src/
  server.ts              # listen + graceful shutdown
  app.ts                 # buildApp() — exported so tests can use app.inject()
  platform/              # config, DI container, error taxonomy
  adapters/              # ports + implementations (auth, notifier) + test mocks
  db/                    # drizzle schema, client, migrations, seed
  modules/<name>/        # routes → service → repository (+ helpers, constants)
test/                    # *.test.ts hermetic · *.it.test.ts DB-backed
```

Conventions the code follows (and PRs are checked against) are in [CLAUDE.md](CLAUDE.md).

## Further reading

- **[docs/](docs/)** — how the service works: [architecture](docs/architecture.md),
  [API reference](docs/api.md), [database](docs/database.md), [testing](docs/testing.md),
  and the [decisions](docs/decisions.md) behind the odd-looking bits.
- **[specs/](specs/)** — behavioural contracts per feature, plus a
  [template](specs/TEMPLATE.md) for new ones.
- **[insights/](insights/)** — verified findings about how the system really behaves
  ([INSIGHTS.md](insights/INSIGHTS.md)) and the traps that cost you an hour
  ([gotchas.md](insights/gotchas.md)).
- **[.claude/](.claude/)** — review agents and task playbooks for working in this repo.
