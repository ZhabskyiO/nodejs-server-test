import type { CachePort } from '../ports.js';

/**
 * Default CachePort when no REDIS_URL is configured: every read is a miss, every
 * write is dropped. Keeps `pnpm dev`, `pnpm test` and CI runnable without a
 * Redis container, and keeps the cache opt-in rather than a hard dependency.
 */
export class NoopCache implements CachePort {
  async get(): Promise<string | null> {
    return null;
  }

  async set(): Promise<void> {}

  async del(): Promise<void> {}

  async close(): Promise<void> {}
}
