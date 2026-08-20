# API reference

Base URL `http://localhost:3005`. JSON in, JSON out. No auth — every request resolves to
the seeded default workspace and system user via `LocalAuthProvider`.

The README has the one-line summary; this is the full contract, including the exact
validation bounds each endpoint enforces.

## Conventions

**Status codes**

| Code | When |
|---|---|
| 200 | read, update, delete, action |
| 201 | resource created |
| 404 | resource missing, or belonging to another workspace (indistinguishable by design) |
| 409 | invalid state transition |
| 422 | request failed validation |
| 429 | rate limit (120 req/min; disabled under `NODE_ENV=test`) |
| 500 | unknown failure — generic message only |
| 503 | readiness probe, DB unreachable |

**Error body** — every non-2xx, from the single handler in `src/app.ts`:

```json
{ "error": { "code": "not_found", "message": "Article not found", "details": null } }
```

Codes: `validation_error`, `not_found`, `conflict`, `bad_request`, `internal_error`,
`config_error`. `details` carries zod issues on a 422 and structured context on a 409;
it is never a driver message, a stack, or SQL.

**Pagination** — every list endpoint takes `?page=&limit=` and returns the same envelope:

```json
{ "items": [ … ], "page": 1, "limit": 20, "total": 57 }
```

`page` ≥ 1 (default 1), `limit` 1–100 (default 20), both coerced from strings. `total`
ignores pagination and respects the filters.

**Types** — ids are uuid v4; a non-uuid `:id` is a 422, not a 404. Timestamps are ISO
8601 strings, `null` where the column is nullable. `workspaceId` is never present in a
response. Request bodies over 1 MB are rejected by Fastify's `bodyLimit`.

---

## Health

### `GET /health`

Liveness. No DB, no rate limit. Always `200 { "status": "ok" }`.

### `GET /health/ready`

Readiness — runs `SELECT 1`.

- `200 { "ready": true }`
- `503 { "ready": false }` when the DB is unreachable. 503 rather than 500 so an
  orchestrator reads it as "not ready yet" rather than a crash; the driver error is
  logged, never returned.

---

## Articles

### `POST /articles` → 201

```json
{ "title": "Hello World", "body": "first post", "tags": ["Node", "node"], "status": "draft" }
```

| Field | Rules |
|---|---|
| `title` | required, 1–200 chars |
| `body` | required, 1–50 000 chars |
| `tags` | optional, ≤ 10 entries, each 1–64 chars |
| `status` | optional, `draft` \| `published`, default `draft` |

Server-side: `slug` is generated from the title (lowercased, accents stripped, non-alnum
collapsed to `-`, capped at 80 chars) and de-duplicated **within the workspace** —
`hello-world`, `hello-world-2`, `hello-world-3`. A title that slugifies to nothing becomes
`untitled`. Tags are trimmed, lowercased, truncated to 32 chars, de-duplicated, and capped
at 10. `authorId` comes from the resolved context; a client cannot set it.

```json
{
  "id": "…", "slug": "hello-world", "title": "Hello World", "body": "first post",
  "status": "draft", "tags": ["node"], "authorId": "…",
  "publishedAt": null, "createdAt": "2026-08-19T…Z", "updatedAt": "2026-08-19T…Z"
}
```

Errors: **422** validation.

### `GET /articles` → 200

`?status=&tag=&q=&page=&limit=`

- `status` — `draft` | `published`
- `tag` — exact match against the normalized (lowercased) tag array
- `q` — case-insensitive substring over title **and** body, 1–200 chars
- newest first (`createdAt desc`)

Returns `paginated(Article)`. Errors: **422** on a bad filter or page value.

### `GET /articles/:id` → 200

Errors: **422** non-uuid id · **404** `Article not found`.

### `PATCH /articles/:id` → 200

```json
{ "title": "New title", "body": "…", "tags": ["a"] }
```

All three optional, but **at least one must be present** — an empty body is a 422, not a
silent no-op. `status` is not patchable (use the publish action) and **the slug is never
recomputed**: it is part of the article's public URL and rewriting it would break existing
links. `updatedAt` is bumped.

Errors: **422** · **404**.

### `POST /articles/:id/publish` → 200

Draft → published: sets `status`, `publishedAt` and `updatedAt`, then fires
`Notifier.articlePublished`. Returns the updated article.

Errors: **404** · **409** `Article is already published`, with
`details: { "articleId": "…" }`.

There is no unpublish endpoint.

### `DELETE /articles/:id` → 200

```json
{ "deleted": "<id>" }
```

Hard delete. Comments go with it via `ON DELETE CASCADE`. Errors: **404**.

---

## Comments

Comments are anonymous — `author` is free text supplied per comment, unrelated to `users`.

### `POST /articles/:id/comments` → 201

```json
{ "author": "ada", "body": "nice post" }
```

`author` 1–80 chars, `body` 1–5 000 chars, both required. The parent article is looked up
**in the caller's workspace** first, so a comment can never attach to another tenant's
article.

```json
{ "id": "…", "articleId": "…", "author": "ada", "body": "nice post", "createdAt": "…" }
```

Errors: **422** · **404** `Article not found`.

### `GET /articles/:id/comments` → 200

`?page=&limit=`, newest first, `paginated(Comment)`. Errors: **404** if the article does
not exist in this workspace.

### `DELETE /comments/:id` → 200

Addressed by comment id, not nested — `{ "deleted": "<id>" }`. Errors: **404**
`Comment not found`.

---

## Examples

```bash
# create → publish → comment
ID=$(curl -s -XPOST localhost:3005/articles -H 'content-type: application/json' \
  -d '{"title":"Hello","body":"world","tags":["node"]}' | jq -r .id)

curl -s -XPOST "localhost:3005/articles/$ID/publish" | jq .status
curl -s "localhost:3005/articles?status=published&q=hello&limit=5" | jq '.total'
curl -s -XPOST "localhost:3005/articles/$ID/comments" -H 'content-type: application/json' \
  -d '{"author":"ada","body":"nice"}'
```

## Changing this contract

Request and response schemas are declared per route in `routes.ts` and are the source of
truth — this file follows them. A removed or renamed response field, a narrowed type, a
new required request field, a changed status code, or a tightened bound is a **breaking
change** and belongs in the PR description. See the `add-endpoint` skill and the
`api-contract-reviewer` agent under `.claude/`.
