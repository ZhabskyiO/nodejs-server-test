import type { ArticleRow } from './repository.js';
import { MAX_TAGS, MAX_TAG_LENGTH } from './constants.js';

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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The instant a draft has to predate to count as stale. `days = 0` means "any
 * draft not touched in this exact millisecond", which is what the digest smoke
 * test leans on to fire without waiting two weeks.
 */
export function staleCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}

/** One digest line: `<slug> — untouched since 2026-07-28 (14d)`. */
export function toDigestLine(row: ArticleRow, now: Date): string {
  const idleDays = Math.floor((now.getTime() - row.updatedAt.getTime()) / MS_PER_DAY);
  const since = row.updatedAt.toISOString().slice(0, 10);
  return `${row.slug} — untouched since ${since} (${idleDays}d)`;
}

export interface ArticleDto {
  id: string;
  slug: string;
  title: string;
  body: string;
  status: string;
  tags: string[];
  authorId: string;
  publishedAt: string | null;
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
    status: row.status,
    tags: row.tags,
    authorId: row.authorId,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
