import { and, arrayContains, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

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
  search?: string;
  page: number;
  limit: number;
}

export class ArticleRepository {
  constructor(private db: Db) {}

  /** Build the shared WHERE for list/count so the two can never diverge. */
  private listWhere(workspaceId: string, filters: ListFilters): SQL | undefined {
    const clauses: SQL[] = [eq(t.articles.workspaceId, workspaceId)];
    if (filters.status) clauses.push(eq(t.articles.status, filters.status));
    if (filters.tag) clauses.push(arrayContains(t.articles.tags, [filters.tag]));
    if (filters.search) {
      const pattern = `%${filters.search}%`;
      const match = or(ilike(t.articles.title, pattern), ilike(t.articles.body, pattern));
      if (match) clauses.push(match);
    }
    return and(...clauses);
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
      .where(and(eq(t.articles.workspaceId, workspaceId), eq(t.articles.id, id)));
    return row;
  }

  async findBySlug(workspaceId: string, slug: string): Promise<ArticleRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.articles)
      .where(and(eq(t.articles.workspaceId, workspaceId), eq(t.articles.slug, slug)));
    return row;
  }

  /** Slugs already taken in this workspace that start with `base` (dedupe input). */
  async slugsLike(workspaceId: string, base: string): Promise<string[]> {
    const rows = await this.db
      .select({ slug: t.articles.slug })
      .from(t.articles)
      .where(and(eq(t.articles.workspaceId, workspaceId), ilike(t.articles.slug, `${base}%`)));
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
      .where(and(eq(t.articles.workspaceId, workspaceId), eq(t.articles.id, id)))
      .returning();
    return row;
  }

  /**
   * Move an article to `status`. `publishedAt` is only written when the caller
   * supplies one, so re-entering a state never rewrites the publication date.
   */
  async setStatus(
    workspaceId: string,
    id: string,
    status: string,
    publishedAt?: Date,
  ): Promise<ArticleRow | undefined> {
    const [row] = await this.db
      .update(t.articles)
      .set({ status, ...(publishedAt && { publishedAt }), updatedAt: new Date() })
      .where(and(eq(t.articles.workspaceId, workspaceId), eq(t.articles.id, id)))
      .returning();
    return row;
  }

  /** Comments are removed by the FK's ON DELETE CASCADE. */
  async remove(workspaceId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(t.articles)
      .where(and(eq(t.articles.workspaceId, workspaceId), eq(t.articles.id, id)))
      .returning({ id: t.articles.id });
    return deleted.length > 0;
  }
}
