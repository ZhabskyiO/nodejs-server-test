import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { dockerAvailable, startPg, truncateDomain, type PgFixture } from './helpers/pg.js';
import { testConfig } from './helpers/app.js';

const hasDocker = await dockerAvailable();

describe.skipIf(!hasDocker)('tags (db)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;

  beforeAll(async () => {
    pg = await startPg();
    app = await buildApp({ config: testConfig(), db: pg.handle.db });
  });

  afterEach(async () => {
    await truncateDomain(pg);
  });

  afterAll(async () => {
    await app.close();
    await pg.stop();
  });

  const create = async (title: string, tags: string[]) =>
    app.inject({ method: 'POST', url: '/articles', payload: { title, body: 'x', tags } });

  it('returns an empty list when no article carries a tag', async () => {
    await create('Untagged', []);

    const res = await app.inject({ method: 'GET', url: '/tags' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: [], page: 1, totalCount: 0 });
  });

  it('counts tag usage across articles, most used first', async () => {
    await create('One', ['node', 'api']);
    await create('Two', ['node']);
    await create('Three', ['node', 'api', 'testing']);

    const res = await app.inject({ method: 'GET', url: '/tags' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([
      { name: 'node', count: 3 },
      { name: 'api', count: 2 },
      { name: 'testing', count: 1 },
    ]);
    expect(res.json().totalCount).toBe(3);
  });

  it('normalizes tags before counting them', async () => {
    await create('One', ['Node']);
    await create('Two', [' node ']);

    expect((await app.inject({ method: 'GET', url: '/tags' })).json().items).toEqual([
      { name: 'node', count: 2 },
    ]);
  });

  it('paginates over the distinct tags', async () => {
    await create('One', ['a', 'b', 'c']);

    const res = await app.inject({ method: 'GET', url: '/tags?page=2&limit=2' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ page: 2, perPage: 2, totalCount: 3 });
    expect(res.json().items).toHaveLength(1);
  });
});
