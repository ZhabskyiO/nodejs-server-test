import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import * as t from '../src/db/schema.js';
import { dockerAvailable, startPg, truncateDomain, type PgFixture } from './helpers/pg.js';
import { testConfig } from './helpers/app.js';

const hasDocker = await dockerAvailable();

describe.skipIf(!hasDocker)('comments (db)', () => {
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

  const createArticle = async () =>
    (await app.inject({
      method: 'POST',
      url: '/articles',
      payload: { title: 'Host Article', body: 'x' },
    })).json();

  it('creates a comment on an existing article', async () => {
    const article = await createArticle();
    const res = await app.inject({
      method: 'POST',
      url: `/articles/${article.id}/comments`,
      payload: { author: 'ann', body: 'nice post' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ articleId: article.id, author: 'ann', body: 'nice post' });
  });

  it('404s when the parent article does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/articles/11111111-1111-4111-8111-111111111111/comments',
      payload: { author: 'ann', body: 'hi' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe('Article not found');
  });

  it('rejects an empty comment body', async () => {
    const article = await createArticle();
    const res = await app.inject({
      method: 'POST',
      url: `/articles/${article.id}/comments`,
      payload: { author: 'ann', body: '' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('lists comments newest-first with pagination metadata', async () => {
    const article = await createArticle();
    for (const body of ['one', 'two', 'three']) {
      await app.inject({
        method: 'POST',
        url: `/articles/${article.id}/comments`,
        payload: { author: 'ann', body },
      });
    }

    const res = await app.inject({ method: 'GET', url: `/articles/${article.id}/comments?limit=2` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ page: 1, limit: 2, total: 3 });
    expect(res.json().items).toHaveLength(2);
  });

  it('deletes a comment by id', async () => {
    const article = await createArticle();
    const comment = (
      await app.inject({
        method: 'POST',
        url: `/articles/${article.id}/comments`,
        payload: { author: 'ann', body: 'bye' },
      })
    ).json();

    const del = await app.inject({ method: 'DELETE', url: `/comments/${comment.id}` });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/comments/${comment.id}` })).statusCode).toBe(
      404,
    );
  });

  it('cascades comment deletion when the article is removed', async () => {
    const article = await createArticle();
    await app.inject({
      method: 'POST',
      url: `/articles/${article.id}/comments`,
      payload: { author: 'ann', body: 'orphan me' },
    });

    await app.inject({ method: 'DELETE', url: `/articles/${article.id}` });

    const rows = await pg.handle.db
      .select()
      .from(t.comments)
      .where(eq(t.comments.articleId, article.id));
    expect(rows).toHaveLength(0);
  });
});
