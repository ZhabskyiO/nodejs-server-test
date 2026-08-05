import 'dotenv/config';
import { createDb } from './client.js';
import * as t from './schema.js';
import { DEFAULT_WORKSPACE_ID, SYSTEM_USER_ID } from '../adapters/auth/local.js';

/**
 * Seed the single workspace + system user that the local AuthProvider hands to
 * every request. Idempotent — re-running is a no-op.
 */
export async function seed(databaseUrl: string): Promise<void> {
  const handle = createDb(databaseUrl, { max: 1 });
  try {
    await handle.db
      .insert(t.workspaces)
      .values({ id: DEFAULT_WORKSPACE_ID, name: 'Default workspace' })
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
  } finally {
    await handle.close();
  }
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  seed(url)
    .then(() => {
      console.log('✓ seeded default workspace + system user');
      process.exit(0);
    })
    .catch((err) => {
      console.error('✗ seed failed:', err);
      process.exit(1);
    });
}
