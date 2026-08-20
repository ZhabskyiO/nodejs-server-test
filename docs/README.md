# Docs

How this service actually works. Descriptive — what the code does today.

| Doc | Read it when |
|---|---|
| [architecture.md](architecture.md) | you need the layering, the request lifecycle, or how the DI container and ports fit together |
| [api.md](api.md) | you are calling the API, or changing a request/response shape |
| [database.md](database.md) | you are touching the schema, an index, a migration, or tenancy |
| [testing.md](testing.md) | you are writing a test, or a suite is failing |
| [decisions.md](decisions.md) | something in the code looks wrong and you want to know why it is that way |

## Related

- **[../CLAUDE.md](../CLAUDE.md)** — the enforceable rules, in short form. These docs
  expand on them; where the two disagree, CLAUDE.md wins and this folder is stale.
- **[../README.md](../README.md)** — setup and the endpoint summary.
- **[../specs/](../specs/)** — prescriptive: what a feature is *supposed* to do. Docs
  describe the system, specs define behaviour before it exists.
- **[../.claude/](../.claude/)** — agents that review changes against these rules
  (`layering-reviewer`, `tenancy-auditor`, `api-contract-reviewer`) and skills that walk
  through common tasks (`new-feature-module`, `add-endpoint`, `db-schema-change`,
  `api-tests`).

## Keeping them true

These docs are read by both people and agents, so a stale line is worse than a missing
one. The code is always the source of truth — route schemas define the contract, the
schema files define the tables. If a change makes a paragraph here wrong, fix it in the
same PR.
