# 0001 — Articles

**Status:** implemented
**Module:** `src/modules/articles/`
**Tables:** `articles`

Retrospective spec: describes behaviour that already ships. It is the contract the code is
held to, not a plan.

## Problem

The service needs a primary content resource with enough substance to exercise real review
rules: a generated identifier with a collision rule, a state transition, list filtering,
and an outbound side effect.

## Scope

In: create, read, list with filters, partial update, publish, delete. Slug generation and
per-workspace de-duplication. Tag normalization. A notification on publish.

Out:

- **Unpublish** — the reverse transition has no defined semantics for `publishedAt`.
- **Slug rewriting on rename** — the slug is a public URL component.
- **Full-text search** — `q` is a substring match; ranked search is a different feature.
- **Soft delete** — deletes are hard, comments cascade.
- **Author permissions** — there is no real auth in this fixture.

## Model

`articles`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `workspace_id` | uuid NOT NULL | → `workspaces`, cascade |
| `author_id` | uuid NOT NULL | → `users`, cascade |
| `slug` | text NOT NULL | unique per workspace |
| `title` | text NOT NULL | |
| `body` | text NOT NULL | |
| `status` | text NOT NULL | default `draft` |
| `tags` | text[] NOT NULL | default `{}` |
| `published_at` | timestamptz NULL | set on publish |
| `created_at` / `updated_at` | timestamptz NOT NULL | `updated_at` bumped on every write |

Indexes: `articles_ws_slug_uq` unique `(workspace_id, slug)`;
`articles_ws_status_created_idx` on `(workspace_id, status, created_at)` serving the
default list query.

**States:** `draft → published`, one-way. `published → published` is a 409.

## API

### `POST /articles` → 201

| Field | Type | Rules |
|---|---|---|
| `title` | string | required, 1–200 |
| `body` | string | required, 1–50 000 |
| `tags` | string[] | optional, ≤ 10, each 1–64 |
| `status` | enum | optional, `draft` \| `published`, default `draft` |

Server-derived: `id`, `slug`, `authorId`, `createdAt`, `updatedAt`, `publishedAt` (null).

Response: the article DTO — `id`, `slug`, `title`, `body`, `status`, `tags`, `authorId`,
`publishedAt`, `createdAt`, `updatedAt`. No `workspaceId`.

Errors: 422 `validation_error`.

### `GET /articles` → 200

Query: `status` (`draft` | `published`), `tag` (1–64), `q` (1–200), `page` ≥ 1 default 1,
`limit` 1–100 default 20. Returns `{ items, page, limit, total }`, newest first.

Errors: 422 on any out-of-range parameter.

### `GET /articles/:id` → 200
Errors: 422 non-uuid · 404 `not_found` "Article not found".

### `PATCH /articles/:id` → 200

`title`, `body`, `tags` — all optional, at least one required. Errors: 422 (including an
empty body) · 404.

### `POST /articles/:id/publish` → 200
Errors: 404 · 409 `conflict` "Article is already published", `details: { articleId }`.

### `DELETE /articles/:id` → 200
`{ "deleted": "<id>" }`. Errors: 404.

## Rules

1. `slug` derives from `title`: NFKD-normalized, diacritics stripped, lowercased,
   non-alphanumeric runs collapsed to `-`, trimmed of leading/trailing `-`, capped at 80
   characters.
2. A title that reduces to an empty slug (punctuation only, non-Latin script) becomes
   `untitled`.
3. Slugs are unique within a workspace. A collision appends the lowest free suffix:
   `hello`, `hello-2`, `hello-3`. Beyond 50 attempts, a timestamp suffix is used rather
   than failing the request.
4. Two workspaces may hold the same slug.
5. `slug` never changes after creation. `PATCH` offers no way to alter it.
6. Tags are trimmed, lowercased, truncated to 32 characters, de-duplicated preserving
   first-seen order, and capped at 10. Empty tags are dropped. Normalization happens on
   write, so the `tag` filter is an exact match.
7. `status` may be set to `published` at creation, but `publishedAt` is only set by the
   publish action — a directly-created published article has a null `publishedAt`.
8. Publishing sets `status`, `publishedAt` and `updatedAt` to the same instant.
9. Publishing an already-published article is a 409 and has no side effects — no
   notification, no `updatedAt` bump.
10. A successful publish emits exactly one `Notifier.articlePublished` event carrying
    `articleId`, `workspaceId`, `title`, `slug`, after the write commits.
11. `q` matches case-insensitively as a substring of title **or** body.
12. `total` reflects the filters and ignores pagination.
13. Deleting an article deletes its comments via `ON DELETE CASCADE`.
14. `authorId` comes from the resolved request context and is never client-settable.

## Tenancy

Every endpoint scopes by the caller's workspace. An article in another workspace is
**404** on read, update, publish and delete, and absent from lists. `workspaceId` appears
in no response — it is neither in the DTO mapper nor in the response schema.

## Ports

`Notifier.articlePublished(event)` — implemented by `ConsoleNotifier`, overridden in tests
by `MockNotifier`. Fire-and-forget; a notifier failure is not specified to roll back the
publish.

## Acceptance criteria

Hermetic (`test/routes-smoke.test.ts`, `test/articles-helpers.test.ts`):

- [x] empty body → 422 `validation_error`, no DB call
- [x] title over 200 chars → 422
- [x] unknown `status` value → 422
- [x] non-uuid `:id` → 422
- [x] empty `PATCH` body → 422
- [x] an unexpected internal failure never leaks the driver error message
- [x] `slugify` handles accents, punctuation, empty results, the 80-char cap
- [x] `normalizeTags` lowercases, de-duplicates, caps count and length

DB-backed (`test/articles.it.test.ts`):

- [x] creates as draft with a generated slug, normalized tags, null `publishedAt`
- [x] response carries no `workspaceId`
- [x] de-duplicates slugs within a workspace (`same-title`, `same-title-2`)
- [x] reads back by id; missing id → 404 with the error envelope
- [x] updates fields without rewriting the slug
- [x] publish sets status + `publishedAt` and emits one notification
- [x] publishing twice → 409, no second notification
- [x] list filters by status, tag and `q`; `total` respects filters and ignores paging
- [x] delete removes the article and cascades its comments
- [ ] a caller in another workspace gets 404 on read/update/publish/delete — not yet
      covered; needs a second workspace seeded and `MockAuthProvider` pinning the tenant

## Compatibility

Baseline — nothing precedes it.
