import type {
  ArticlePublishedEvent,
  AuthProvider,
  CachePort,
  Notifier,
  RequestIdentity,
} from './ports.js';
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

/**
 * In-process CachePort. TTLs are recorded but never expire — a test that needs
 * expiry should call `del()` rather than wait on a clock.
 */
export class InMemoryCache implements CachePort {
  readonly entries = new Map<string, { value: string; ttlSeconds: number }>();
  /** Every key ever asked for, in order — lets a test assert on hits/misses. */
  readonly reads: string[] = [];

  async get(key: string): Promise<string | null> {
    this.reads.push(key);
    return this.entries.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, ttlSeconds });
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async close(): Promise<void> {}
}
