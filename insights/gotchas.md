# Gotchas

Things that will cost you an hour. Indexed by the symptom you actually see, because that
is what you have when you go looking.

[INSIGHTS.md](INSIGHTS.md) is the analysis of *why* the system behaves the way it does;
this is the lookup table.

---

## Setup and tooling

### `relation "articles" does not exist`

Migrations **never run on boot**. A fresh database needs them applied by hand:

```bash
docker compose up -d && pnpm db:migrate && pnpm db:seed
```

Deliberate — an app that migrates on start will do it from several replicas at once on a
bad deploy.

### `ECONNREFUSED localhost:5432`

Postgres is on **5433**, not the default, so it does not fight a local install. Your
`.env` came from `.env.example` and already says 5433 — this usually means a tool
defaulted on its own, or `.env` is missing entirely (`cp .env.example .env`).

### `MODULE_NOT_FOUND` from `pnpm db:generate`

Someone added `.js` extensions to imports inside `src/db/schema.ts` or `src/db/schema/**`.
Those files are extensionless **on purpose** — drizzle-kit loads them through
esbuild-register (CJS), which cannot map a `.js` specifier back to `.ts`. Everywhere else
in the repo, relative imports must keep `.js`. This is the one exception, and it looks
exactly like a mistake, so it gets "fixed" regularly.

### `pnpm db:generate` produces an empty migration after adding a table

The table is not in the barrel. `src/db/schema.ts` needs **both** — the `export *` line
and an entry in the `schema` object passed to `drizzle()`. Adding only the first compiles
fine and generates nothing.

### The generated migration will not apply

Read the SQL before committing; drizzle-kit emits statements it cannot verify:

- `ADD COLUMN … NOT NULL` fails against existing rows without a default. Add `.default(…)`,
  or split into add-nullable → backfill → enforce.
- A **rename** is emitted as drop + add, destroying the column's data. drizzle-kit's
  interactive prompt is not available in this environment, so hand-edit to
  `ALTER TABLE … RENAME COLUMN …` before it runs anywhere real.

### `LOG_LEVEL=` in `.env` does not break, but `LOG_LEVEL=verbose` does

The config schema preprocesses `''` → `undefined` so the empty line in `.env.example`
falls through to the default. An *invalid* value is a startup crash from
`EnvSchema.parse` — by design, but the error names the enum rather than the file it came
from.

---

## Tests

### A test passes locally and fails in CI with a DB error

The **filename** picks the CI lane. `*.it.test.ts` runs in the `integration` job with
Postgres; anything else runs in `unit`, where there is no database at all. A DB-touching
test named `foo.test.ts` passes locally (you have Docker) and fails only in CI, with an
error that says nothing about lanes.

### `pnpm test:it` says everything passed but nothing ran

Integration suites are wrapped in `describe.skipIf(!hasDocker)`. With no Docker daemon
they skip **silently and green**. Check the skip count, not the exit code. CI is safe here
— GitHub's ubuntu runners ship Docker, so a locally-skipped suite still runs there.

### A test "passes" but proves nothing

Hermetic suites run against `explodingDb()`, whose every method throws. If your assertion
is only `expect(res.statusCode).toBe(422)`, it may be passing because validation rejected
the request long before your logic ran — which is fine when that *is* the test, and
worthless when you meant to exercise a service. If the code under test needs a row, it
belongs in `*.it.test.ts`.

### The first integration run takes minutes

Testcontainers pulls `postgres:16` on first use. `testTimeout`/`hookTimeout` are already
120 s for this reason. Start Postgres once per **suite** in `beforeAll` and use
`truncateDomain()` between tests — re-running migrations per test is what makes these
unbearable.

### A test fails only when run with others

Two things bite here: `MockNotifier.published` is an array that must be cleared in
`afterEach` (`notifier.published.length = 0`), and `truncateDomain()` deletes comments
before articles — order matters, because of the FK.

---

## Writing code

### A field you added to the response is missing at runtime

Response serialization validates against `schema.response[status]` and **strips whatever
the schema does not declare**. A field added to the DTO mapper but not to the Zod
response schema vanishes with no error anywhere. (This is also the mechanism that keeps
`workspaceId` off the wire, so it is load-bearing.)

The mirror case is louder but stranger: a field the schema *requires* and the mapper omits
throws a serialization error, which the handler logs and returns as a **generic 500** —
so a typo in a response schema surfaces as an internal error, not a validation message.

Adding a field means three edits in lockstep: the DTO mapper, the response schema, the
tests.

### A new endpoint returns 404 in the wrong shape

The module is not in the static registry. `src/modules/index.ts` lists plugins by hand —
there is no autoload, because dynamic `import()` of `.ts` is not portable across tsx /
tsc / vitest. The confusing part is the shape: an unmatched route bypasses the error
handler entirely and returns Fastify's `{message, error, statusCode}` instead of the
envelope, so it does not look like the API's own 404 (see
[INSIGHTS #3](INSIGHTS.md#3-unknown-routes-break-the-error-envelope)).

### Errors from a new module are not in the envelope

`setErrorHandler` must stay **before** the module loop in `buildApp()`. Fastify plugins
are encapsulated and inherit the handler present at registration time; moving it after the
loop leaves every module route on Fastify's default handler, and nothing fails loudly.

### `?tag=Something` returns nothing though the tag exists

Tags are lowercased on write and the filter is not normalised on read, so `?tag=Node`
matches zero rows while `?tag=node` matches. See
[INSIGHTS #4](INSIGHTS.md#4-tag-filtering-is-case-asymmetric--writes-normalise-reads-do-not).

### A tag comes back shorter than you sent it

The route accepts up to 64 characters per tag; `normalizeTags` truncates at 32. No error —
just quietly shorter data. [INSIGHTS #5](INSIGHTS.md#5-tag-length-is-bounded-twice-inconsistently--the-wider-bound-wins-silently).

### `POST /articles` intermittently returns 500

Concurrent creates with the same title race on slug de-duplication and lose to the unique
index; the driver error becomes a generic `internal_error`. Reproducible at concurrency 5.
[INSIGHTS #2](INSIGHTS.md#2-concurrent-creates-with-the-same-title-return-500).

### An article says `"status": "published"` but nothing was notified

It was created with `status: "published"` rather than published through the action, so
`publishedAt` is null, no event fired, and `POST /publish` now 409s forever.
[INSIGHTS #1](INSIGHTS.md#1-an-article-created-with-status-published-can-never-actually-be-published).

### `PATCH` with an unrecognised field is a 422, not a no-op

Zod strips unknown keys, so `{ "bogus": 1 }` becomes `{}` and trips the `.refine` that
requires at least one real field. That is the intended behaviour — worth knowing before
you go looking for a schema bug.

### A non-uuid `:id` gives 422, not 404

`IdParams` validates at the edge, so a malformed id never reaches the database. It is a
malformed request, not a missing resource.

### Your service change compiles but the reviewer rejects it

The rules that are enforced by convention rather than the compiler: no `Schema.parse()` in
a handler, no SQL outside a repository, every repository query scoped by `workspaceId`,
no `process.env` outside `platform/config.ts`, errors thrown rather than built, adapters
constructed only in the container. Run the `layering-reviewer`, `tenancy-auditor` and
`api-contract-reviewer` agents in [`../.claude/agents/`](../.claude/agents/) before
opening the PR — they check exactly these.

---

## Debugging

### The 500 has no detail

By design: anything that is not an `AppError` or a zod error returns a fixed
`{ code: 'internal_error', message: 'Internal error' }`, because a Postgres error string
can contain the connection URL, credentials included. The real error **is** logged. If
logs are empty too, check `LOG_LEVEL` — `testConfig()` sets `silent`, so an app built with
it in a scratch script tells you nothing.

### `/health` is fine but `/health/ready` returns 503

That is the readiness probe doing its job: it runs `SELECT 1` and reports 503 (not 500) so
an orchestrator reads it as "not ready yet". The DB is unreachable — check
`docker compose ps` and `DATABASE_URL`. In hermetic tests it returns 503 *always*, because
`explodingDb()` throws on `execute`.

### A scratch script fails with "Top-level await is not supported with the cjs output format"

The script is outside the project directory, so it does not inherit `"type": "module"` and
tsx treats it as CJS. Put throwaway scripts at the **repo root** (and delete them after) —
this repo is pure ESM.
