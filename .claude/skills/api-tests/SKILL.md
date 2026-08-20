---
name: api-tests
description: Write or fix tests for this Fastify/Drizzle API — choosing the CI lane, using buildTestApp/explodingDb for hermetic suites and the Testcontainers Postgres fixture for DB-backed ones, and swapping adapters via container overrides. Use for "add a test", "test this endpoint", failing vitest runs, or Testcontainers/Docker test issues.
---

# Testing conventions

Two lanes, picked by filename. `*.it.test.ts` is DB-backed and runs against a
Testcontainers Postgres; **anything else must run with no database at all**. CI runs them
as separate jobs, so a hermetic-named file that touches a DB fails only in the unit job —
where there is no Postgres to explain it.

```bash
pnpm test        # both lanes
pnpm test:unit   # DB-free
pnpm test:it     # Testcontainers (needs Docker)
```

## Hermetic suites — `test/<name>.test.ts`

Use for validation, status codes, error mapping, and pure helpers. `buildTestApp()` wires
the real app with a test config and an `explodingDb()` — a `Db` stand-in whose every
entrypoint throws. That is the point: a test that passes with an exploding DB has proved
no query ran before validation, and a test that hits it proves driver text does not reach
the client.

```ts
import { buildTestApp } from './helpers/app.js';

const app = await buildTestApp();
const res = await app.inject({ method: 'POST', url: '/articles', payload: { title: '' } });
expect(res.statusCode).toBe(422);
expect(res.json().error.code).toBe('validation_error');
```

`app.inject()` throughout — no port is ever bound. Close the app in `afterAll`.

Pure functions (`slugify`, `normalizeTags`, `toArticleDto`) are tested directly, no app.

## DB-backed suites — `test/<name>.it.test.ts`

```ts
const hasDocker = await dockerAvailable();

describe.skipIf(!hasDocker)('articles CRUD (db)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let notifier: MockNotifier;

  beforeAll(async () => {
    pg = await startPg();
    notifier = new MockNotifier();
    app = await buildApp({ config: testConfig(), db: pg.handle.db, overrides: { notifier } });
  });

  afterEach(async () => {
    await truncateDomain(pg);
    notifier.published.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await pg.stop();
  });
});
```

`startPg()` starts Postgres 16, runs migrations and seeds the default workspace + system
user. Always gate on `dockerAvailable()` with `describe.skipIf` so the suite self-skips on
a machine with no daemon instead of hanging. One container per suite in `beforeAll`;
`truncateDomain()` between tests — re-running migrations per test is what makes these
suites unbearable. Timeouts are already 120s in `vitest.config.ts`.

## Swapping adapters

`buildApp({ overrides })` is the seam — never monkey-patch a service. `MockNotifier`
records what it was told (`notifier.published`), so an outbound effect is asserted as
data. `MockAuthProvider` pins the tenant, which is how you prove isolation: seed a row
under one workspace, rebuild the app with a second workspace's identity, and assert 404
rather than 200. Every new repository query deserves that test.

## What to assert

- The status code **and** `res.json().error.code` — the envelope is the contract.
- Absence as well as presence: `expect(article).not.toHaveProperty('workspaceId')`.
- The state transition, not just the 200 — publish twice and expect a 409 on the second.
- Pagination `total` against a seeded count, so a filter that diverges between `list()`
  and `count()` is caught.
- That an internal failure returns a generic message: assert the response does **not**
  contain the driver string `explodingDb()` was given.

Reach into `pg.handle.db` directly only to seed or to verify a write the API cannot show
you. Assertions about behaviour go through `app.inject()`.
