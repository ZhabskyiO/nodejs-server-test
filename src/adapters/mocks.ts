import type { ArticlePublishedEvent, AuthProvider, Notifier, RequestIdentity } from './ports.js';
import { DEFAULT_WORKSPACE_ID, SYSTEM_USER_ID } from './auth/local.js';

/** Records what it was told, so tests can assert on outbound effects. */
export class MockNotifier implements Notifier {
  readonly published: ArticlePublishedEvent[] = [];

  async articlePublished(event: ArticlePublishedEvent): Promise<void> {
    this.published.push(event);
  }
}

/** Lets a test pin the tenant (e.g. to prove cross-workspace reads are blocked). */
export class MockAuthProvider implements AuthProvider {
  constructor(
    private identity: RequestIdentity = {
      workspaceId: DEFAULT_WORKSPACE_ID,
      userId: SYSTEM_USER_ID,
    },
  ) {}

  async resolve(): Promise<RequestIdentity> {
    return this.identity;
  }
}
