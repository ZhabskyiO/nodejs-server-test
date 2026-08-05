import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type DbHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import * as t from '../../src/db/schema.js';
import { DEFAULT_WORKSPACE_ID, SYSTEM_USER_ID } from '../../src/adapters/auth/local.js';

/**
 * Testcontainers helper: start Postgres, run migrations, seed the default
 * workspace + system user, hand back a Drizzle client.
 *
 * Integration suites gate on `dockerAvailable()` and skip cleanly where no
 * Docker daemon is reachable.
 */
export interface PgFixture {
  container: StartedPostgreSqlContainer;
  handle: DbHandle;
  url: string;
  stop: () => Promise<void>;
}

let dockerCache: boolean | undefined;

/** Cheap check: can we reach a Docker daemon? */
export async function dockerAvailable(): Promise<boolean> {
  if (dockerCache !== undefined) return dockerCache;
  try {
    const { execSync } = await import('node:child_process');
    execSync('docker info', { stdio: 'ignore', timeout: 5000 });
    dockerCache = true;
  } catch {
    dockerCache = false;
  }
  return dockerCache;
}

export async function startPg(): Promise<PgFixture> {
  const container = await new PostgreSqlContainer('postgres:16')
    .withDatabase('apitest')
    .withUsername('apitest')
    .withPassword('apitest')
    .start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  const handle = createDb(url, { max: 5 });

  await handle.db
    .insert(t.workspaces)
    .values({ id: DEFAULT_WORKSPACE_ID, name: 'Test workspace' })
    .onConflictDoNothing();
  await handle.db
    .insert(t.users)
    .values({
      id: SYSTEM_USER_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      email: 'system@example.com',
      displayName: 'System',
    })
    .onConflictDoNothing();

  return {
    container,
    handle,
    url,
    stop: async () => {
      await handle.close();
      await container.stop();
    },
  };
}

/** Wipe domain rows between tests without re-running migrations. */
export async function truncateDomain(fixture: PgFixture): Promise<void> {
  await fixture.handle.db.delete(t.comments);
  await fixture.handle.db.delete(t.articles);
}
