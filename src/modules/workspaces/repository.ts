import { asc } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Workspaces data-access layer. The ONLY place that touches the `workspaces`
 * table.
 *
 * There are no routes over this table — a workspace is the tenancy root, not a
 * resource the API exposes — so this module is deliberately absent from
 * `src/modules/index.ts`. It exists because background jobs run across tenants
 * and need the list of them; request-path code gets its workspace from
 * `getContext()` instead and must never call this.
 */
export class WorkspaceRepository {
  constructor(private db: Db) {}

  async listIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .orderBy(asc(t.workspaces.createdAt));
    return rows.map((r) => r.id);
  }
}
