import { and, eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Tenancy guard, in one place. Every repository query filters by
 * `workspace_id` — spelling that predicate out at each call site is how a read
 * eventually ships without it, so build the WHERE through here instead.
 *
 * `undefined` extras are dropped, so an optional filter can be passed inline.
 */
export function workspaceScope(
  table: { workspaceId: PgColumn },
  workspaceId: string,
  ...extra: (SQL | undefined)[]
): SQL {
  // `and()` returns undefined only when handed nothing; the workspace
  // predicate is always present, so the result is a SQL node.
  return and(eq(table.workspaceId, workspaceId), ...extra)!;
}
