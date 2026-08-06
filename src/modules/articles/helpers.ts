import type { ArticleRow } from './repository.js';
import { MAX_TAGS, MAX_TAG_LENGTH, type ArticleStatus } from './constants.js';

/**
 * Pure transforms for the articles module — no DB, no I/O, unit-testable.
 */

/** Lowercase, strip accents/punctuation, collapse to single hyphens. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  // Titles made entirely of punctuation/non-latin script collapse to ''; fall
  // back to a stable placeholder so the unique index still has something to key.
  return slug || 'untitled';
}

/** Trim, lowercase, drop empties and duplicates, cap length and count. */
export function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

export interface ArticleDto {
  id: string;
  slug: string;
  title: string;
  body: string;
  status: ArticleStatus;
  tags: string[];
  authorId: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Row → wire shape. `workspaceId` is deliberately NOT exposed: it is a tenancy
 * internal, and the response schema in routes.ts pins this contract.
 */
export function toArticleDto(row: ArticleRow): ArticleDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    status: row.status as ArticleStatus,
    tags: row.tags,
    authorId: row.authorId,
    // Only carried while the article actually has a publication date.
    publishedAt: row.publishedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
