<!--
PR title must follow Conventional Commits (feat:, fix:, refactor:, chore:, test:, docs:)
— the repo squash-merges, so the title becomes the commit message.
-->

## What & why

<!-- One paragraph: what changed and what problem it solves. -->

## How to verify

<!-- Commands / requests a reviewer can run. -->

```bash
pnpm typecheck && pnpm test
```

## Checklist

Architecture (see [CLAUDE.md](../CLAUDE.md)):

- [ ] Request validation happens at the route edge via a Zod `schema` — no `Schema.parse(req.body)` inside a handler
- [ ] Every new/changed repository query is scoped by `workspaceId`
- [ ] Errors are **thrown** (`NotFoundError`, `ConflictError`, …) — no hand-built error responses
- [ ] Handlers get the tenant from `getContext()`; no direct `process.env` or header parsing in services
- [ ] No SQL or external SDK call outside a repository/adapter
- [ ] New external dependency (if any) sits behind a port in `src/adapters/ports.ts` and is wired in `platform/container.ts`

API contract:

- [ ] Response schemas updated for any changed response shape (breaking changes called out above)
- [ ] Status codes follow the existing convention (201 create, 404 missing, 409 conflict, 422 validation)

DB:

- [ ] Schema change has a generated migration committed (`pnpm db:generate`)
- [ ] Indexes considered for any new filter/sort column

Tests:

- [ ] Hermetic tests for new validation/error paths (`test/*.test.ts`)
- [ ] DB-backed tests for new persistence behaviour (`test/*.it.test.ts` — the suffix decides the CI lane)
