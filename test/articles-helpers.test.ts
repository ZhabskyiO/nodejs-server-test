import { describe, expect, it } from 'vitest';
import {
  normalizeTags,
  slugify,
  staleCutoff,
  toArticleDto,
  toDigestLine,
} from '../src/modules/articles/helpers.js';
import type { ArticleRow } from '../src/modules/articles/repository.js';
import { MAX_TAGS } from '../src/modules/articles/constants.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips punctuation and collapses separators', () => {
    expect(slugify('  Node.js:  the *good* parts!! ')).toBe('node-js-the-good-parts');
  });

  it('strips accents', () => {
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu');
  });

  it('falls back to a placeholder when nothing survives', () => {
    expect(slugify('日本語')).toBe('untitled');
    expect(slugify('!!!')).toBe('untitled');
  });

  it('never ends with a hyphen after truncation', () => {
    const slug = slugify('a'.repeat(78) + ' word');
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.length).toBeLessThanOrEqual(80);
  });
});

describe('normalizeTags', () => {
  it('returns an empty array for undefined', () => {
    expect(normalizeTags(undefined)).toEqual([]);
  });

  it('trims, lowercases and de-duplicates', () => {
    expect(normalizeTags([' Node ', 'node', 'NODE', 'api'])).toEqual(['node', 'api']);
  });

  it('drops blank tags', () => {
    expect(normalizeTags(['  ', 'ok'])).toEqual(['ok']);
  });

  it('caps the tag count', () => {
    const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `tag${i}`);
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS);
  });
});

describe('toArticleDto', () => {
  const row: ArticleRow = {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    authorId: '33333333-3333-4333-8333-333333333333',
    slug: 'hello',
    title: 'Hello',
    body: 'World',
    status: 'draft',
    tags: ['node'],
    publishedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  it('serializes dates to ISO strings', () => {
    const dto = toArticleDto(row);
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.publishedAt).toBeNull();
  });

  it('does not leak workspaceId to the wire', () => {
    expect(toArticleDto(row)).not.toHaveProperty('workspaceId');
  });

  describe('staleCutoff', () => {
    const now = new Date('2026-08-11T09:00:00.000Z');

    it('subtracts whole days from now', () => {
      expect(staleCutoff(now, 14).toISOString()).toBe('2026-07-28T09:00:00.000Z');
    });

    it('returns now itself for 0 days', () => {
      expect(staleCutoff(now, 0).getTime()).toBe(now.getTime());
    });

    it('crosses a DST boundary without drifting (UTC arithmetic)', () => {
      const cutoff = staleCutoff(new Date('2026-03-30T09:00:00.000Z'), 1);
      expect(cutoff.toISOString()).toBe('2026-03-29T09:00:00.000Z');
    });
  });

  describe('toDigestLine', () => {
    it('reports the slug, the date and the idle days', () => {
      const line = toDigestLine(
        { ...row, updatedAt: new Date('2026-07-28T09:00:00.000Z') },
        new Date('2026-08-11T09:00:00.000Z'),
      );
      expect(line).toBe('hello — untouched since 2026-07-28 (14d)');
    });

    it('floors a partial day rather than rounding up', () => {
      const line = toDigestLine(
        { ...row, updatedAt: new Date('2026-08-10T23:00:00.000Z') },
        new Date('2026-08-11T09:00:00.000Z'),
      );
      expect(line).toContain('(0d)');
    });
  });
});
