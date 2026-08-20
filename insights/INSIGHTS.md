# Insights

Findings from reading and probing this codebase — what is actually true about its
behaviour, as opposed to what the structure implies. Everything below was **reproduced**
against the real app (`app.inject()` against Postgres 16 on 5433), not inferred from
reading. Reproduction snippets are included so a claim can be re-checked after a change.

Last verified: **2026-08-19**, at `d7c379c`.

This file is analytical: it records where the system is inconsistent, fragile, or
surprising. It is not a defence of the design ([`../docs/decisions.md`](../docs/decisions.md)
is) nor a description of intent ([`../specs/`](../specs/) is). Where an insight
contradicts a spec, the spec describes what *should* happen and this file records what
does.

See [gotchas.md](gotchas.md) for the practical "this will waste an hour" list.

---

## 1. An article created with `status: "published"` can never actually be published

**Severity: high — silently unreachable state.**

`POST /articles` accepts `status` in the body, but `publishedAt` is only ever written by
the publish *action*. So a client that creates a published article gets a row that claims
to be published, has no publish timestamp, and emitted no notification — and the publish
endpoint then refuses it forever, because the conflict check reads `status`:

```
POST /articles {"title":"…","status":"published"}  → 201  status=published, publishedAt=null
POST /articles/:id/publish                          → 409  "Article is already published"
notifications emitted                               → 0
```

The row is stranded: no timestamp, no event, and no path to either. Downstream consumers
of `articlePublished` never learn the article exists, and anything sorting or filtering on
`publishedAt` skips it.

Three ways out, in increasing order of honesty: drop `status` from the create body and
make publishing the only route into the state; set `publishedAt` (and fire the notifier)
when creating directly as published; or keep the field and make the conflict check test
`publishedAt !== null` instead of `status`, so the action can complete a half-published
row. The first is the smallest and matches [spec 0001](../specs/0001-articles.md)'s
one-way state machine.

## 2. Concurrent creates with the same title return 500

**Severity: high — reproducible under trivial concurrency.**

Slug de-duplication reads the taken slugs, picks a free suffix in memory, then inserts.
Between the read and the insert, another request can take the same suffix. The unique
index `articles_ws_slug_uq` catches it — data stays correct — but the driver error is not
an `AppError`, so it falls through to the generic branch of the error handler:

```
5 concurrent POST /articles {"title":"Race Me"}
→ 500, 201, 500, 201, 201        slugs: —, race-me, —, race-me-2, race-me-3
```

Two of five failed. The client sees `internal_error` with no indication that retrying
would work. This is the read-then-write race the "one query fetches the taken prefixes"
optimisation makes *more* likely, not less — the whole candidate set is decided before
the insert.

The robust fix is to stop pre-computing: insert, catch the unique violation
(`23505`), and retry with the next suffix. That makes the database the arbiter instead of
a stale in-memory snapshot. A cheaper mitigation is to map `23505` to a `ConflictError`
so at least the client is told to retry — but it turns a solvable problem into the
caller's.

## 3. Unknown routes break the error envelope

**Severity: medium — every client's error handling has an unhandled shape.**

`src/app.ts` registers `setErrorHandler` but no `setNotFoundHandler`. Fastify's default
404 never reaches the error handler, so an unmatched path returns Fastify's own body:

```
GET /nope
→ 404 {"message":"Route GET:/nope not found","error":"Not Found","statusCode":404}
```

Every other error in the system is `{ error: { code, message, details } }`. A client that
parses `body.error.code` gets the string `"Not Found"` where it expects `"not_found"`; a
client that reads `body.error.message` gets `undefined`. The documented contract — in the
README, [`../docs/api.md`](../docs/api.md), and every response schema — is simply not true
for unmatched paths.

It is a four-line fix (`app.setNotFoundHandler` sending the envelope with
`code: 'not_found'`), and it should be registered next to the error handler, before the
module loop, for the same encapsulation reason.

This also makes a *missing module registration* hard to diagnose: forgetting to add a
plugin to `src/modules/index.ts` produces a 404 in a different shape from every real 404.

## 4. Tag filtering is case-asymmetric — writes normalise, reads do not

**Severity: medium — a filter that silently returns nothing.**

`normalizeTags()` lowercases on write. The `tag` querystring is validated as a plain
1–64-char string and passed to `arrayContains` unchanged:

```
POST /articles {"tags":["Node"]}   → stored as ["node"]
GET  /articles?tag=Node            → total 0
GET  /articles?tag=node            → total 1
```

A caller who filters by the tag *they just sent* gets an empty list. Nothing errors; the
result is simply wrong. The fix is one call — normalise the filter through the same helper
as the write — and it belongs in the service, so the two can never diverge again.

The same asymmetry class is worth checking anywhere else normalisation happens on write:
the rule is that a value written through a transform must be *read* through the same
transform.

## 5. Tag length is bounded twice, inconsistently — the wider bound wins silently

**Severity: low — data loss without an error.**

The route schema allows `z.string().min(1).max(64)` per tag; `normalizeTags` truncates at
`MAX_TAG_LENGTH = 32`. Anything in between is accepted and quietly cut in half:

```
POST /articles {"tags":["xxxx…"]}   (40 chars)  → 201, stored tag length 32
```

Validation exists to reject what the system cannot represent. Here it accepts it and the
service mangles it. `TagSchema` should use `MAX_TAG_LENGTH` — the constant is already
exported from the same `constants.ts` the route imports `MAX_TAGS` from, which suggests
the `64` is a leftover rather than a decision.

Worth a general check: every bound expressed in a Zod schema should be *the same constant*
the layer below enforces, not a second opinion about it.

## 6. `q` passes LIKE wildcards straight through

**Severity: low functionally, medium operationally.**

The search filter builds `` `%${filters.q}%` `` and hands it to `ilike`. User-supplied `%`
and `_` keep their wildcard meaning:

```
GET /articles?q=%25    (a bare %)  → matches every article
```

This is not SQL injection — the value is parameterised — but it is wildcard injection: `_`
matches any character, so `a_b` matches `axb`, and a lone `%` degenerates the filter into
"everything". The operational half is worse than the semantic half: `ilike '%…%'` on
`body` is a leading-wildcard match against unindexed text, so a search endpoint that a
caller can force to full-scan the table is a cheap way to make the database unhappy.

Escaping `%`, `_` and `\` in the input fixes the semantics. The scan is inherent to
substring search — the real answer is a trigram index or full-text search, which
[spec 0001](../specs/0001-articles.md) explicitly puts out of scope, so it should stay a
known limit rather than a surprise.

## 7. Publish is a read-then-write, and the notifier is not transactional

**Severity: low today, structural.**

`publish()` reads the row, checks `status`, then updates. Two concurrent publishes can
both read `draft` and both proceed — the conflict check cannot see the other transaction.
The update itself is idempotent, so the data survives, but the notifier fires **twice**
for one article.

I did not reproduce a double notification (the window is narrow at this scale), so treat
this as a latent race rather than a live defect. It is the same class as insight 2: a
decision made from a value read in an earlier statement. The fix is to make the update
itself conditional — `where status = 'draft'` — and treat "no row returned" as the
conflict, which collapses check and write into one atomic statement.

Related: the notifier is awaited *after* the commit with no compensation. A notifier that
throws propagates to the error handler and returns 500 for an article that **is**
published. For `ConsoleNotifier` that cannot happen; for a real HTTP or queue adapter it
will. Whether the port should be fire-and-forget (log failures, never fail the request) or
transactional (outbox) is an open design question this fixture does not answer.

## 8. List ordering has no tiebreaker

**Severity: informational — did not reproduce.**

Both list queries sort by `created_at desc` alone. Rows created in the same transaction
share `now()`, so their relative order is unspecified, and unstable ordering across pages
means an item can be seen twice or missed entirely while paginating.

I tried this — six comments inserted in a single statement, read back across two pages of
three — and got six distinct ids. Postgres returned a stable order here. That is not a
guarantee, though: it is an artifact of a small heap scan with no concurrent activity.
Adding `, desc(t.<table>.id)` as a secondary sort costs nothing and removes the question.

Recorded as informational precisely because it did **not** reproduce — worth knowing, not
worth alarm.

## 9. `users_email_uq` is global, not per workspace

**Severity: informational — dormant, will bite on real auth.**

Every other uniqueness constraint in the schema is composite with `workspace_id`.
`users_email_uq` is on `email` alone, so one person cannot exist in two workspaces. There
is no users endpoint, so nothing exercises it today — but the moment this fixture grows
real authentication, it becomes a genuine tenancy bug, and it is the kind that surfaces as
a confusing insert failure rather than a wrong answer.

## 10. The 429 path is never exercised

**Severity: informational.**

The rate limiter is skipped entirely under `NODE_ENV=test`, and every suite runs in test
mode. That is the right call for suite stability — but it means the limiter's
configuration, its interaction with the error handler, and the shape of the 429 body have
no coverage at all. A 429 from `@fastify/rate-limit` does not go through `setErrorHandler`
either, so it is likely to have the same envelope mismatch as insight 3, undetected.

If it matters, one focused test can build an app with `NODE_ENV=development` and assert
the 429 shape, without re-enabling the limiter for the rest of the suite.

---

## Patterns worth carrying forward

Several findings above are the same mistake wearing different clothes:

- **A value transformed on write must be read through the same transform** (4), and a
  bound stated in two layers must be the same constant (5). Both are "two places that must
  agree, with nothing making them agree".
- **A decision made from a previously-read value is a race** (2, 7). The fix is always to
  push the condition into the statement that writes.
- **A response that does not pass through the error handler does not have the envelope**
  (3, 10). The envelope is a property of one code path, not of the application.

The structural rules this repo enforces — layering, tenancy scoping, validation at the
edge — are held well; the reviewers in [`../.claude/agents/`](../.claude/agents/) check
them and I found no violations. Every finding above sits in the space those rules do not
reach: consistency *between* correctly-layered pieces. That is the useful lesson about the
architecture — it makes a whole class of error impossible and says nothing about these.

## Re-verifying

Insights 1–6 are cheap to re-check with a throwaway script at the repo root (it must live
there, not in a temp directory — the package is ESM and top-level `await` needs the
project's `type: module`):

```ts
// probe.ts  —  pnpm exec tsx probe.ts, then delete it
import { buildApp } from './src/app.js';
import { createDb } from './src/db/client.js';
import { testConfig } from './test/helpers/app.js';

const h = createDb('postgres://apitest:apitest@localhost:5433/apitest');
const app = await buildApp({ config: testConfig(), db: h.db });
console.log((await app.inject({ method: 'GET', url: '/nope' })).body);
await app.close(); await h.close();
```

Needs `docker compose up -d` and `pnpm db:migrate` first. Better still: turn any of these
into a real test — several are one assertion each, and insights 1, 3 and 4 belong in
`test/*.it.test.ts` as regression coverage the moment they are fixed.
