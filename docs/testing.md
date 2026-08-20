# Testing

Vitest, two lanes, split by **filename**:

| Lane | Files | Needs | CI job |
|---|---|---|---|
| Hermetic | `test/*.test.ts`, `src/**/*.test.ts` | nothing | `unit` |
| DB-backed | `test/*.it.test.ts` | Docker | `integration` |

```bash
pnpm test        # both
pnpm test:unit   # DB-free  (vitest run --exclude '**/*.it.test.ts')
pnpm test:it     # Testcontainers
```

The suffix is the whole mechanism. A DB-touching test named `*.test.ts` fails only in the
`unit` job — where there is no Postgres to explain it.

## Hermetic suites

For validation, status codes, error mapping, and pure functions. `buildTestApp()` wires
the **real** app with a test config and an `explodingDb()` — a `Db` stand-in whose every
entrypoint throws `connection refused: password=hunter2`.

That is the point of the design. A test that passes against an exploding DB has proved no
query ran before validation; a test that deliberately hits it proves driver text does not
reach the client.

```ts
const app = await buildTestApp();

// validation happens before any db call
const res = await app.inject({ method: 'POST', url: '/articles', payload: {} });
expect(res.statusCode).toBe(422);
expect(res.json().error.code).toBe('validation_error');
```

`testConfig()` sets `NODE_ENV=test` (which disables the rate limit), `LOG_LEVEL=silent`,
and a `DATABASE_URL` that is never dialled. Everything goes through `app.inject()` — no
port is ever bound. Close the app in `afterAll`.

Pure functions (`slugify`, `normalizeTags`, `toArticleDto`, the error taxonomy) are tested
directly, with no app at all — see `test/articles-helpers.test.ts` and
`test/errors.test.ts`.

## DB-backed suites

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

`startPg()` (`test/helpers/pg.ts`) starts Postgres 16 in a container, runs the real
migrations, seeds the default workspace + system user, and hands back a Drizzle client.

- Always gate on `dockerAvailable()` with `describe.skipIf` — the suite then skips cleanly
  on a machine with no daemon instead of hanging. The check is a cached `docker info`.
- **One container per suite** in `beforeAll`; `truncateDomain()` between tests. Re-running
  migrations per test is what makes these suites unbearable.
- Timeouts are already 120 s (`testTimeout` and `hookTimeout` in `vitest.config.ts`) —
  pulling the `postgres:16` image the first time is slow.

## Swapping adapters

`buildApp({ overrides })` is the seam. Never monkey-patch a service.

- **`MockNotifier`** records calls in `notifier.published`, so an outbound effect is
  asserted as data: publish an article, expect one event with the right slug.
- **`MockAuthProvider`** pins the tenant. This is how isolation is proved: seed a row under
  one workspace, rebuild the app with a second workspace's identity, and assert **404**
  rather than 200. Every new repository query deserves that test.

Both live in `src/adapters/mocks.ts` — deliberately shipped in `src/`, not `test/`, since
they implement the same ports.

## What to assert

- The status code **and** `res.json().error.code` — the envelope is the contract.
- Absence as well as presence: `expect(article).not.toHaveProperty('workspaceId')`.
- State transitions, not just the happy 200: publish twice, expect 409 on the second.
- Pagination `total` against a seeded count — a filter that diverges between `list()` and
  `count()` shows up nowhere else.
- That internal failures stay internal: assert the response does **not** contain the
  driver string `explodingDb()` was given.

Reach into `pg.handle.db` directly only to seed, or to verify a write the API cannot show
you. Behaviour is asserted through `app.inject()`.

## CI

`.github/workflows/ci.yml` runs three jobs on every push to `main` and every PR:
`typecheck` (`tsc --noEmit`), `unit`, and `integration`. GitHub's ubuntu runners ship a
Docker daemon, so Testcontainers works there without extra setup — meaning a DB-backed
test that self-skips locally still runs in CI.
