import { describe, expect, it } from 'vitest';
import {
  articleCacheKey,
  deserializeArticleRow,
  serializeArticleRow,
  toArticleDto,
} from '../src/modules/articles/helpers.js';
import type { ArticleRow } from '../src/modules/articles/repository.js';
import { InMemoryCache } from '../src/adapters/mocks.js';

const row: ArticleRow = {
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  authorId: '33333333-3333-4333-8333-333333333333',
  slug: 'hello',
  title: 'Hello',
  body: 'Body',
  status: 'published',
  tags: ['a', 'b'],
  publishedAt: new Date('2026-01-02T03:04:05.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-03T00:00:00.000Z'),
};

describe('articleCacheKey', () => {
  it('scopes the key by workspace so the same id cannot collide across tenants', () => {
    expect(articleCacheKey('ws-a', 'id-1')).not.toBe(articleCacheKey('ws-b', 'id-1'));
    expect(articleCacheKey('ws-a', 'id-1')).toBe('article:ws-a:id-1');
  });
});

describe('article row serialization', () => {
  it('round-trips a row with Date fields intact', () => {
    const revived = deserializeArticleRow(serializeArticleRow(row));
    expect(revived).not.toBeNull();
    expect(revived!.createdAt).toBeInstanceOf(Date);
    expect(revived!.publishedAt).toBeInstanceOf(Date);
    // The DTO is the actual contract, so compare through it.
    expect(toArticleDto(revived!)).toEqual(toArticleDto(row));
  });

  it('keeps a null publishedAt null rather than turning it into an epoch date', () => {
    const draft = { ...row, status: 'draft', publishedAt: null };
    const revived = deserializeArticleRow(serializeArticleRow(draft));
    expect(revived!.publishedAt).toBeNull();
  });

  it('treats malformed JSON as a miss', () => {
    expect(deserializeArticleRow('not json')).toBeNull();
  });

  it('treats a payload missing required timestamps as a miss', () => {
    // A key written by an older deploy must never reach toArticleDto().
    expect(deserializeArticleRow(JSON.stringify({ id: row.id, title: 'x' }))).toBeNull();
  });
});

describe('InMemoryCache', () => {
  it('stores, reads back and deletes under the TTL it was given', async () => {
    const cache = new InMemoryCache();
    const key = articleCacheKey(row.workspaceId, row.id);

    expect(await cache.get(key)).toBeNull();
    await cache.set(key, serializeArticleRow(row), 60);
    expect(cache.entries.get(key)?.ttlSeconds).toBe(60);
    expect(await cache.get(key)).not.toBeNull();

    await cache.del(key);
    expect(await cache.get(key)).toBeNull();
    expect(cache.reads).toEqual([key, key, key]);
  });
});
