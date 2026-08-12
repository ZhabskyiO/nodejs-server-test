import { count, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { workspaceScope } from '../_shared/scope.js';

/**
 * Comments data-access layer. The ONLY place that touches the `comments` table.
 * Every query is scoped by `workspaceId` (tenancy guard).
 */

export type CommentRow = typeof t.comments.$inferSelect;

export interface InsertComment {
  workspaceId: string;
  articleId: string;
  author: string;
  body: string;
}

export interface ListPage {
  page: number;
  limit: number;
}

export class CommentRepository {
  constructor(private db: Db) {}

  async listByArticle(
    workspaceId: string,
    articleId: string,
    page: ListPage,
  ): Promise<CommentRow[]> {
    return this.db
      .select()
      .from(t.comments)
      .where(workspaceScope(t.comments, workspaceId, eq(t.comments.articleId, articleId)))
      .orderBy(desc(t.comments.createdAt))
      .limit(page.limit)
      .offset((page.page - 1) * page.limit);
  }

  async countByArticle(workspaceId: string, articleId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(t.comments)
      .where(workspaceScope(t.comments, workspaceId, eq(t.comments.articleId, articleId)));
    return row?.value ?? 0;
  }

  async insert(values: InsertComment): Promise<CommentRow> {
    const [row] = await this.db.insert(t.comments).values(values).returning();
    return row!;
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(t.comments)
      .where(workspaceScope(t.comments, workspaceId, eq(t.comments.id, id)))
      .returning({ id: t.comments.id });
    return deleted.length > 0;
  }
}
