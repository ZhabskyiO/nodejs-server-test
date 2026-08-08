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

/** Cache key for a single article. Workspace-scoped so a key can never be
 * reached from another tenant, even if an id were guessed. */
export function articleCacheKey(workspaceId: string, id: string): string {
  return `article:${workspaceId}:${id}`;
}

/** JSON is lossy for Date, so the timestamps are pinned as ISO strings here… */
export function serializeArticleRow(row: ArticleRow): string {
  return JSON.stringify({
    ...row,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * …and revived here. Returns null for anything that does not round-trip — a key
 * written by an older deploy is a cache miss, never a malformed ArticleRow
 * handed to toArticleDto().
 */
export function deserializeArticleRow(payload: string): ArticleRow | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
  const createdAt = toDate(raw.createdAt);
  const updatedAt = toDate(raw.updatedAt);
  if (!createdAt || !updatedAt || typeof raw.id !== 'string') return null;
  return {
    ...(raw as unknown as ArticleRow),
    publishedAt: toDate(raw.publishedAt),
    createdAt,
    updatedAt,
  };
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
