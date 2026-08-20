# NNNN — <Feature name>

**Status:** draft | accepted | implemented | superseded by NNNN
**Module:** `src/modules/<name>/` (new | existing)
**Tables:** `<table>` (new | changed | none)

## Problem

What cannot be done today, and who is blocked by it. Two or three sentences. If this is a
change to existing behaviour, say what the current behaviour is and why it is wrong.

## Scope

In:

- …

Out (and why):

- …

## Model

The data this introduces or changes. Columns with types, nullability and defaults;
uniqueness and which columns it spans; indexes and the query each one serves. If nothing
changes, say "no schema change".

State machine, if the resource has one — states, allowed transitions, and what an illegal
transition returns.

## API

One subsection per endpoint.

### `METHOD /path` → <status>

Request:

| Field | Type | Rules |
|---|---|---|
| … | … | required/optional, bounds |

Server-derived fields (never client-settable): …

Response:

```json
{ }
```

Errors:

| Status | Code | When |
|---|---|---|
| 404 | `not_found` | … |
| 409 | `conflict` | … |
| 422 | `validation_error` | … |

## Rules

Numbered behaviours a reviewer can check one by one. Each should be testable and stated
without reference to implementation.

1. …

## Tenancy

What a caller from another workspace sees for each endpoint. State it explicitly even when
the answer is the usual 404.

## Ports

Any external effect (notification, third-party call) and the port it goes through. New
capability → new interface in `src/adapters/ports.ts` + implementation + container wiring
+ a `ContainerOverrides` field so tests can swap it. "None" is a valid answer.

## Acceptance criteria

Hermetic — `test/<name>.test.ts`:

- [ ] …

DB-backed — `test/<name>.it.test.ts`:

- [ ] …

## Compatibility

Breaking changes to an existing response or request shape, and what an existing client
sees. Migration concerns — backfills, `NOT NULL` on populated tables, renames. "None" if
this is purely additive.

## Open questions

Anything unresolved, with who decides. Delete the section once the spec is accepted.
