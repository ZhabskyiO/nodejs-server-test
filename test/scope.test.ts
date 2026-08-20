import { describe, expect, it } from 'vitest';
import { eq, ilike } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { workspaceScope } from '../src/modules/_shared/scope.js';
import * as t from '../src/db/schema.js';

const dialect = new PgDialect();
const render = (sql: ReturnType<typeof workspaceScope>) => dialect.sqlToQuery(sql);

/**
 * The tenancy guard is the one predicate that must never go missing, so assert
 * on the SQL it actually emits rather than on the helper returning something.
 */
describe('workspaceScope', () => {
  it('always filters by workspace, even with no extra clauses', () => {
    const { sql, params } = render(workspaceScope(t.articles, 'ws-1'));
    expect(sql).toBe('"articles"."workspace_id" = $1');
    expect(params).toEqual(['ws-1']);
  });

  it('ands extra clauses onto the workspace predicate, in order', () => {
    const { sql, params } = render(
      workspaceScope(t.articles, 'ws-1', eq(t.articles.status, 'draft')),
    );
    expect(sql).toBe('("articles"."workspace_id" = $1 and "articles"."status" = $2)');
    expect(params).toEqual(['ws-1', 'draft']);
  });

  it('drops undefined extras so optional filters can be passed inline', () => {
    const tag: string | undefined = undefined;
    const { sql, params } = render(
      workspaceScope(
        t.articles,
        'ws-1',
        tag ? eq(t.articles.status, tag) : undefined,
        ilike(t.articles.slug, 'hello%'),
      ),
    );
    expect(sql).toBe('("articles"."workspace_id" = $1 and "articles"."slug" ilike $2)');
    expect(params).toEqual(['ws-1', 'hello%']);
  });

  it('scopes any table with a workspaceId column', () => {
    const { sql } = render(workspaceScope(t.comments, 'ws-1', eq(t.comments.id, 'c-1')));
    expect(sql).toBe('("comments"."workspace_id" = $1 and "comments"."id" = $2)');
  });
});
