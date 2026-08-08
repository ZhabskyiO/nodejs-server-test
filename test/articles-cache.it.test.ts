import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { InMemoryCache, MockNotifier } from '../src/adapters/mocks.js';
import { articleCacheKey, serializeArticleRow } from '../src/modules/articles/helpers.js';
import { DEFAULT_WORKSPACE_ID } from '../src/adapters/auth/local.js';
import { dockerAvailable, startPg, truncateDomain, type PgFixture } from './helpers/pg.js';
import { testConfig } from './helpers/app.js';

const hasDocker = await dockerAvailable();

describe.skipIf(!hasDocker)('article read cache (db)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let cache: InMemoryCache;

  beforeAll(async () => {
    pg = await startPg();
    cache = new InMemoryCache();
    app = await buildApp({
      config: testConfig(),
      db: pg.handle.db,
      overrides: { cache, notifier: new MockNotifier() },
    });
  });

  afterEach(async () => {
    await truncateDomain(pg);
    cache.entries.clear();
    cache.reads.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await pg.stop();
  });

  const create = async (title: string) =>
    (await app.inject({ method: 'POST', url: '/articles', payload: { title, body: 'x' } })).json();

  const get = async (id: string) => app.inject({ method: 'GET', url: `/articles/${id}` });
  const key = (id: string) => articleCacheKey(DEFAULT_WORKSPACE_ID, id);

  it('populates the cache on first read and serves the second read from it', async () => {
    const { id } = await create('Cached');
    expect(cache.entries.has(key(id))).toBe(false);

    const first = await get(id);
    expect(first.statusCode).toBe(200);
    expect(cache.entries.has(key(id))).toBe(true);

    // Poison the cached copy: if the second read still says 'Cached', the
    // read-through path is not actually being used.
    const poisoned = { ...first.json(), title: 'From cache' };
    await cache.set(
      key(id),
      serializeArticleRow({
        ...poisoned,
        workspaceId: DEFAULT_WORKSPACE_ID,
        publishedAt: null,
        createdAt: new Date(poisoned.createdAt),
        updatedAt: new Date(poisoned.updatedAt),
      }),
      60,
    );
    expect((await get(id)).json().title).toBe('From cache');
  });

  it('does not cache a 404, so an id can become readable later', async () => {
    const missing = '44444444-4444-4444-8444-444444444444';
    expect((await get(missing)).statusCode).toBe(404);
    expect(cache.entries.size).toBe(0);
  });

  it('invalidates on update', async () => {
    const { id } = await create('Before');
    await get(id);
    await app.inject({ method: 'PATCH', url: `/articles/${id}`, payload: { title: 'After' } });
    expect(cache.entries.has(key(id))).toBe(false);
    expect((await get(id)).json().title).toBe('After');
  });

  it('invalidates on publish', async () => {
    const { id } = await create('Publishable');
    await get(id);
    await app.inject({ method: 'POST', url: `/articles/${id}/publish` });
    expect(cache.entries.has(key(id))).toBe(false);
    expect((await get(id)).json().status).toBe('published');
  });

  it('rejects a double publish even when the stale row is cached as a draft', async () => {
    const { id } = await create('Once');
    await get(id); // caches status: draft
    expect((await app.inject({ method: 'POST', url: `/articles/${id}/publish` })).statusCode).toBe(
      200,
    );
    // The conflict check reads fresh, so the cached draft must not let this through.
    const second = await app.inject({ method: 'POST', url: `/articles/${id}/publish` });
    expect(second.statusCode).toBe(409);
  });

  it('invalidates on delete', async () => {
    const { id } = await create('Doomed');
    await get(id);
    await app.inject({ method: 'DELETE', url: `/articles/${id}` });
    expect(cache.entries.has(key(id))).toBe(false);
    expect((await get(id)).statusCode).toBe(404);
  });
});
