import { Redis } from 'ioredis';
import type { CachePort } from '../ports.js';

/**
 * Redis-backed CachePort. The only file in the codebase that imports ioredis.
 *
 * Failure policy: a cache is an optimisation, so every operation swallows its
 * transport error and reports a miss. A Redis outage therefore degrades reads
 * to plain DB reads instead of turning them into 500s.
 */
export class RedisCache implements CachePort {
  private readonly client: Redis;

  constructor(url: string, private readonly onError?: (err: Error) => void) {
    this.client = new Redis(url, {
      // Fail fast instead of queueing commands while the socket is down —
      // a queued command would hold the request open past its usefulness.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    // ioredis emits 'error' on every reconnect attempt; an unhandled 'error'
    // event would crash the process, so it always needs a listener.
    this.client.on('error', (err: Error) => this.onError?.(err));
    void this.client.connect().catch((err: Error) => this.onError?.(err));
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (err) {
      this.onError?.(err as Error);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (err) {
      this.onError?.(err as Error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      this.onError?.(err as Error);
    }
  }

  async close(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
