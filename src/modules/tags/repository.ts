import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Tag data-access layer. Tags have no table of their own — they live in the
 * `articles.tags` array — so this reads through `articles`, always scoped by
 * `workspaceId`.
 */

export interface TagCountRow {
  name: string;
  count: number;
}

export interface ListPage {
  page: number;
  limit: number;
}

export class TagRepository {
  constructor(private db: Db) {}

  /** Distinct tags with their usage counts, most used first. */
  async list(workspaceId: string, page: ListPage): Promise<TagCountRow[]> {
    const rows = await this.db.execute<{ name: string; count: string }>(sql`
      select tag as name, count(*)::int as count
      from ${t.articles}, unnest(${t.articles.tags}) as tag
      where ${t.articles.workspaceId} = ${workspaceId}
      group by tag
      order by count desc, tag asc
      limit ${page.limit}
      offset ${(page.page - 1) * page.limit}
    `);
    return [...rows].map((row) => ({ name: row.name, count: Number(row.count) }));
  }

  /** Distinct tag count, ignoring pagination. */
  async count(workspaceId: string): Promise<number> {
    const rows = await this.db.execute<{ count: string }>(sql`
      select count(distinct tag)::int as count
      from ${t.articles}, unnest(${t.articles.tags}) as tag
      where ${t.articles.workspaceId} = ${workspaceId}
    `);
    return Number([...rows][0]?.count ?? 0);
  }
}
