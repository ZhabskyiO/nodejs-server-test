# 0002 — Comments

**Status:** implemented
**Module:** `src/modules/comments/`
**Tables:** `comments`
**Depends on:** [0001-articles](0001-articles.md)

Retrospective spec. Its reason for existing is the parent-child relationship: it is the
reference for how a nested resource proves ownership before it writes.

## Problem

Articles need a child resource, so the codebase demonstrates a write whose validity
depends on a row owned by a **different** module — the case where tenancy is easiest to
get wrong.

## Scope

In: create a comment on an article, list an article's comments, delete a comment by id.

Out:

- **Editing a comment** — no update path; delete and re-create.
- **Threading / replies** — no `parent_id`.
- **Moderation, voting, reactions** — no state on a comment at all.
- **Comment authors as real users** — `author` is free text; comments are anonymous here.

## Model

`comments`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `workspace_id` | uuid NOT NULL | → `workspaces`, cascade |
| `article_id` | uuid NOT NULL | → `articles`, cascade |
| `author` | text NOT NULL | free text, not a FK |
| `body` | text NOT NULL | |
| `created_at` | timestamptz NOT NULL | |

Index: `comments_article_created_idx` on `(article_id, created_at)` — the listing query.

No `updated_at`: a comment is immutable once written.

`workspace_id` is stored on the comment even though it is derivable through
`article_id`. It keeps every comment query scoped by the same single predicate as every
other table, so the tenancy rule has no exceptions to remember.

## API

### `POST /articles/:id/comments` → 201

| Field | Type | Rules |
|---|---|---|
| `author` | string | required, 1–80 |
| `body` | string | required, 1–5 000 |

Server-derived: `id`, `articleId` (from the path), `workspaceId`, `createdAt`.

Response: `{ id, articleId, author, body, createdAt }`.

Errors: 422 `validation_error` · 404 `not_found` "Article not found".

### `GET /articles/:id/comments` → 200

Query: `page` ≥ 1 default 1, `limit` 1–100 default 20. Returns
`{ items, page, limit, total }`, newest first.

Errors: 422 · 404 "Article not found".

### `DELETE /comments/:id` → 200

`{ "deleted": "<id>" }`. Addressed by comment id rather than nested — a comment id is
globally unique, and the nested form would let the two ids disagree.

Errors: 422 non-uuid · 404 `not_found` "Comment not found".

## Rules

1. Creating and listing both resolve the parent article **in the caller's workspace**
   first. A missing or foreign article is 404 "Article not found" — the comment endpoints
   never reveal that an article exists elsewhere.
2. The parent lookup goes through `ArticleRepository`; the comments module never queries
   the `articles` table itself.
3. `articleId` comes from the path. It is not accepted in the body, so it cannot
   disagree with the URL.
4. Comments are ordered newest first by `created_at`.
5. `total` counts every comment on the article, ignoring the page window.
6. Deleting an article deletes its comments through the FK cascade, not through
   application code.
7. Deleting a comment does not touch the article — no counter, no `updated_at` bump.
8. `author` is stored as given (only length-bounded) — no normalization, no link to
   `users`.
9. A comment is immutable: nothing updates a row after insert.

## Tenancy

`POST` and `GET` return 404 for an article in another workspace, identical to an article
that does not exist. `DELETE /comments/:id` scopes on `workspace_id` directly and returns
404 for a foreign comment. `workspaceId` is absent from every response.

## Ports

None. Comments have no outbound effects.

## Acceptance criteria

Hermetic (`test/routes-smoke.test.ts`):

- [x] empty comment body → 422 `validation_error` before any DB call

DB-backed (`test/comments.it.test.ts`):

- [x] creates a comment on an existing article
- [x] 404s when the parent article does not exist
- [x] lists newest-first with pagination metadata
- [x] deletes a comment by id
- [x] removing the article cascades its comments away
- [ ] a comment on another workspace's article → 404 — not yet covered; needs a second
      workspace and `MockAuthProvider`

## Compatibility

Additive over [0001](0001-articles.md). The only coupling is the cascade: any change to
how articles are deleted must preserve comment removal.
