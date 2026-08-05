import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MockNotifier } from '../src/adapters/mocks.js';
import { dockerAvailable, startPg, truncateDomain, type PgFixture } from './helpers/pg.js';
import { testConfig } from './helpers/app.js';

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

  const create = async (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/articles', payload });

  it('creates an article as a draft with a generated slug', async () => {
    const res = await create({ title: 'Hello World', body: 'first post', tags: ['Node', 'node'] });
    expect(res.statusCode).toBe(201);
    const article = res.json();
    expect(article).toMatchObject({
      slug: 'hello-world',
      title: 'Hello World',
      status: 'draft',
      tags: ['node'],
      publishedAt: null,
    });
    expect(article).not.toHaveProperty('workspaceId');
  });

  it('de-duplicates slugs within the workspace', async () => {
    const first = await create({ title: 'Same Title', body: 'a' });
    const second = await create({ title: 'Same Title', body: 'b' });
    expect(first.json().slug).toBe('same-title');
    expect(second.json().slug).toBe('same-title-2');
  });

  it('reads a single article back', async () => {
    const { id } = (await create({ title: 'Readable', body: 'x' })).json();
    const res = await app.inject({ method: 'GET', url: `/articles/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(id);
  });

  it('404s a missing article with the error envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/articles/11111111-1111-4111-8111-111111111111',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: 'not_found', message: 'Article not found' });
  });

  it('updates fields without rewriting the slug', async () => {
    const created = (await create({ title: 'Original Title', body: 'x' })).json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/articles/${created.id}`,
      payload: { title: 'Renamed', tags: ['api'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'Renamed', slug: 'original-title', tags: ['api'] });
  });

  it('publishes once and notifies, then conflicts', async () => {
    const { id } = (await create({ title: 'To Publish', body: 'x' })).json();

    const first = await app.inject({ method: 'POST', url: `/articles/${id}/publish` });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe('published');
    expect(first.json().publishedAt).not.toBeNull();
    expect(notifier.published).toEqual([
      { articleId: id, workspaceId: expect.any(String), title: 'To Publish', slug: 'to-publish' },
    ]);

    const second = await app.inject({ method: 'POST', url: `/articles/${id}/publish` });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('conflict');
    expect(notifier.published).toHaveLength(1);
  });

  it('filters by status, tag and free text', async () => {
    const draft = (await create({ title: 'Draft One', body: 'about fastify', tags: ['api'] })).json();
    await create({ title: 'Other', body: 'unrelated', tags: ['misc'] });
    await app.inject({ method: 'POST', url: `/articles/${draft.id}/publish` });

    const published = await app.inject({ method: 'GET', url: '/articles?status=published' });
    expect(published.json().items).toHaveLength(1);

    const tagged = await app.inject({ method: 'GET', url: '/articles?tag=api' });
    expect(tagged.json().items.map((a: { id: string }) => a.id)).toEqual([draft.id]);

    const searched = await app.inject({ method: 'GET', url: '/articles?q=FASTIFY' });
    expect(searched.json().items).toHaveLength(1);
  });

  it('paginates with a total that ignores the page window', async () => {
    for (let i = 0; i < 5; i++) await create({ title: `Post ${i}`, body: 'x' });

    const res = await app.inject({ method: 'GET', url: '/articles?page=2&limit=2' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ page: 2, limit: 2, total: 5 });
    expect(res.json().items).toHaveLength(2);
  });

  it('deletes an article and 404s afterwards', async () => {
    const { id } = (await create({ title: 'Delete Me', body: 'x' })).json();

    const del = await app.inject({ method: 'DELETE', url: `/articles/${id}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deleted: id });

    expect((await app.inject({ method: 'GET', url: `/articles/${id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/articles/${id}` })).statusCode).toBe(404);
  });
});
