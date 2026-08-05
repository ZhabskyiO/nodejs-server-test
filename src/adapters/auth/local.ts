import type { AuthProvider, RequestIdentity } from '../ports.js';

/**
 * Fixed IDs so the seed, the tests and the running app all agree on which
 * tenant a request belongs to.
 */
export const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
export const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000002';

/**
 * Local AuthProvider — this fixture has no real auth, so every request resolves
 * to the seeded workspace + system user. It exists so handlers depend on the
 * port (and repositories stay tenancy-scoped) rather than hardcoding IDs.
 */
export class LocalAuthProvider implements AuthProvider {
  async resolve(): Promise<RequestIdentity> {
    return { workspaceId: DEFAULT_WORKSPACE_ID, userId: SYSTEM_USER_ID };
  }
}
