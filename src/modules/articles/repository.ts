import { arrayContains, asc, count, desc, eq, ilike, lt, or, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { workspaceScope } from '../_shared/scope.js';

/**
 * Articles data-access layer. The ONLY place that touches the `articles` table.
 * Every query is scoped by `workspaceId` (tenancy guard).
 */

export type ArticleRow = typeof t.articles.$inferSelect;

export interface InsertArticle {
  workspaceId: string;
  authorId: string;
  slug: string;
  title: string;
  body: string;
  status: string;
  tags: string[];
}

export interface UpdateArticle {
  title?: string;
  body?: string;
  tags?: string[];
}

export interface ListFilters {
  status?: string;
  tag?: string;
  q?: string;
  page: number;
  limit: number;
}

export class ArticleRepository {
  constructor(private db: Db) {}

  /** Build the shared WHERE for list/count so the two can never diverge. */
  private listWhere(workspaceId: string, filters: ListFilters): SQL {
    const clauses: (SQL | undefined)[] = [];
    if (filters.status) clauses.push(eq(t.articles.status, filters.status));
    if (filters.tag) clauses.push(arrayContains(t.articles.tags, [filters.tag]));
    if (filters.q) {
      const pattern = `%${filters.q}%`;
      clauses.push(or(ilike(t.articles.title, pattern), ilike(t.articles.body, pattern)));
    }
    return workspaceScope(t.articles, workspaceId, ...clauses);
  }

  async list(workspaceId: string, filters: ListFilters): Promise<ArticleRow[]> {
    return this.db
      .select()
      .from(t.articles)
      .where(this.listWhere(workspaceId, filters))
      .orderBy(desc(t.articles.createdAt))
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit);
  }

  /** Total matching rows, ignoring pagination — for the `total` field. */
  async count(workspaceId: string, filters: ListFilters): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(t.articles)
      .where(this.listWhere(workspaceId, filters));
    return row?.value ?? 0;
  }

  async getById(workspaceId: string, id: string): Promise<ArticleRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.articles)
      .where(workspaceScope(t.articles, workspaceId, eq(t.articles.id, id)));
    return row;
  }

  async findBySlug(workspaceId: string, slug: string): Promise<ArticleRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.articles)
      .where(workspaceScope(t.articles, workspaceId, eq(t.articles.slug, slug)));
    return row;
  }

  /**
   * Drafts nobody has touched since `cutoff`, oldest first — the input to the
   * stale-draft digest job. Bounded so one neglected workspace can't turn the
   * nightly run into a full-table read.
   */
  async listStaleDrafts(workspaceId: string, cutoff: Date, limit: number): Promise<ArticleRow[]> {
    return this.db
      .select()
      .from(t.articles)
      .where(
        workspaceScope(
          t.articles,
          workspaceId,
          eq(t.articles.status, 'draft'),
          lt(t.articles.updatedAt, cutoff),
        ),
      )
      .orderBy(asc(t.articles.updatedAt))
      .limit(limit);
  }

  /** Slugs already taken in this workspace that start with `base` (dedupe input). */
  async slugsLike(workspaceId: string, base: string): Promise<string[]> {
    const rows = await this.db
      .select({ slug: t.articles.slug })
      .from(t.articles)
      .where(workspaceScope(t.articles, workspaceId, ilike(t.articles.slug, `${base}%`)));
    return rows.map((r) => r.slug);
  }

  async insert(values: InsertArticle): Promise<ArticleRow> {
    const [row] = await this.db.insert(t.articles).values(values).returning();
    return row!;
  }

  async update(
    workspaceId: string,
    id: string,
    values: UpdateArticle,
  ): Promise<ArticleRow | undefined> {
    const [row] = await this.db
      .update(t.articles)
      .set({ ...values, updatedAt: new Date() })
      .where(workspaceScope(t.articles, workspaceId, eq(t.articles.id, id)))
      .returning();
    return row;
  }

  async markPublished(
    workspaceId: string,
    id: string,
    publishedAt: Date,
  ): Promise<ArticleRow | undefined> {
    const [row] = await this.db
      .update(t.articles)
      .set({ status: 'published', publishedAt, updatedAt: publishedAt })
      .where(workspaceScope(t.articles, workspaceId, eq(t.articles.id, id)))
      .returning();
    return row;
  }

  /** Comments are removed by the FK's ON DELETE CASCADE. */
  async remove(workspaceId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(t.articles)
      .where(workspaceScope(t.articles, workspaceId, eq(t.articles.id, id)))
      .returning({ id: t.articles.id });
    return deleted.length > 0;
  }
}
