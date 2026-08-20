# Specs

What a feature is **supposed** to do — written before or alongside the code, and kept as
the behavioural contract afterwards. [`../docs/`](../docs/) is the mirror image: it
describes the system as it is.

A spec is worth writing when a change has decisions in it — new endpoints, a state
machine, a rule someone will ask about in review. A one-line bug fix does not need one.

## Files

| Spec | Status |
|---|---|
| [TEMPLATE.md](TEMPLATE.md) | — |
| [0001-articles.md](0001-articles.md) | implemented |
| [0002-comments.md](0002-comments.md) | implemented |

Name them `NNNN-<slug>.md`, numbers never reused. `0001` and `0002` are retrospective:
they document what already shipped, and they are the reference for the shape a new spec
should take.

## Lifecycle

**draft** → **accepted** → **implemented** → (**superseded by NNNN**)

Set `Status:` at the top. Once a spec is implemented, it stops being a plan and becomes
the description of intended behaviour — change it by editing it (and saying so in the PR),
not by letting the code drift away from it. A large change that reverses an earlier
decision gets a new spec that supersedes the old one, rather than a rewrite in place.

## What a spec must contain

The template has the full outline; the parts that make a spec useful rather than
decorative:

- **Behaviour, not implementation.** Say a slug is unique per workspace and stable across
  renames. Do not say which query finds the collisions — that is the code's business.
- **The full HTTP contract.** Path, method, every field with its bounds, every status code
  including the error ones. This is what the response schemas in `routes.ts` will be
  checked against.
- **Errors as first-class cases.** Which condition produces 404 vs 409 vs 422, with the
  exact `code` and message.
- **Tenancy.** Every spec states what a caller from another workspace sees. The answer is
  almost always 404.
- **Acceptance criteria that map to tests.** Each bullet should be recognisable as a test
  name, and split by lane — hermetic (`*.test.ts`) or DB-backed (`*.it.test.ts`).
- **Non-goals.** The cheapest section to write and the one that saves the most review
  time.

## Working from a spec

The `.claude/skills/` playbooks implement one: `new-feature-module` for a new resource,
`add-endpoint` for a change to an existing one, `db-schema-change` for the migration,
`api-tests` for the acceptance criteria. Review the result with the `layering-reviewer`,
`tenancy-auditor` and `api-contract-reviewer` agents.
