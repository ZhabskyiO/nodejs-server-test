---
name: add-endpoint
description: Add or change a route on an existing module in this Fastify/Drizzle API — a new filter, a new action, a changed response shape. Use for "add a search param to articles", "add an unpublish endpoint", "return X in the article response". For a brand-new resource with its own table, use new-feature-module instead.
---

# Adding an endpoint to an existing module

Work outside-in for the contract, inside-out for the code: decide the HTTP shape first,
then implement bottom-up so each layer compiles.

## 1. Fix the contract first

- **Path** — plural collections, uuid `:id`, an action as a `POST` sub-path
  (`/articles/:id/publish`). Children nest under the parent to create and list
  (`/articles/:id/comments`) but are addressed directly to delete (`/comments/:id`).
- **Status** — 201 create · 200 read/update/delete · 404 missing · 409 state conflict ·
  422 validation.
- **Response** — a single resource reuses the module's existing `*Response` schema; a list
  is always `paginated(ItemResponse)` over `PageQuery`.

## 2. Repository first

Add the query to `src/modules/<name>/repository.ts` — the only file that may touch that
table. Take `workspaceId` as the first parameter and put
`eq(t.<table>.workspaceId, workspaceId)` in the `and(...)`. A new filter goes into the
shared `listWhere()` builder so `list()` and `count()` stay in step; a new sort or filter
column wants an index in the schema. Return `Row | undefined`, never throw.

## 3. Service next

Add the method to `service.ts` with the business rule and the error:

```ts
async unpublish(workspaceId: string, id: string): Promise<ArticleRow> {
  const existing = await this.getById(workspaceId, id);       // throws NotFoundError
  if (existing.status !== 'published') {
    throw new ConflictError('Article is not published', { articleId: id });
  }
  return (await this.repo.markDraft(workspaceId, id))!;
}
```

Outbound effects go through a container port (`this.container.notifier.…`), after the
write succeeds.

## 4. Route last

```ts
app.post(
  '/articles/:id/unpublish',
  { schema: { params: IdParams, response: { 200: ArticleResponse, 404: ApiError, 409: ApiError } } },
  async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return toArticleDto(await service.unpublish(workspaceId, req.params.id));
  },
);
```

Rules that bite here:

- `schema` does all validation — no `Schema.parse(req.body)`, no manual query coercion.
- List every status the handler can produce in `response`, error statuses included; an
  undeclared status serializes unvalidated.
- New input bounds (`.max(...)`) live in the module's `constants.ts`.
- A partial-update body keeps `.refine((v) => Object.values(v).some((f) => f !== undefined))`
  so an empty PATCH cannot no-op with a 200.
- Never build an error response by hand — throw, and let the handler in `src/app.ts`
  render `{ error: { code, message, details } }`.

## 5. Changing an existing response

Adding a field means editing three places in lockstep — the DTO mapper in `helpers.ts`,
the Zod `*Response` schema, and the test assertions. A field the mapper returns but the
schema omits is silently stripped; a field the schema requires but the mapper omits throws
a serialization error that surfaces as a generic 500. Removing or renaming a field, or
narrowing a type, is a breaking change: call it out in the PR description.

## 6. Cover it

A new validation or error path gets a hermetic test (`test/*.test.ts`); new persistence
behaviour gets `test/*.it.test.ts`. Then:

```bash
pnpm typecheck && pnpm test
```
