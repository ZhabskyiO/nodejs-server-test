import type { Db } from '../db/client.js';
import type { AppConfig } from './config.js';
import type { AuthProvider, CachePort, Notifier } from '../adapters/ports.js';
import { LocalAuthProvider } from '../adapters/auth/local.js';
import { ConsoleNotifier } from '../adapters/notifier/console.js';
import { NoopCache } from '../adapters/cache/noop.js';
import { RedisCache } from '../adapters/cache/redis.js';

/**
 * Test seams. `buildApp({ overrides })` swaps a real adapter for a fake without
 * touching any service.
 */
export interface ContainerOverrides {
  auth?: AuthProvider;
  notifier?: Notifier;
  cache?: CachePort;
}

/** Just enough of the Fastify logger for adapters to report degraded state. */
export interface ContainerLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Composition root. The ONLY place that constructs adapters. Services receive
 * the container and reach infrastructure through it — they never import an SDK
 * (or `process.env`) directly.
 */
export class Container {
  private _auth?: AuthProvider;
  private _notifier?: Notifier;
  private _cache?: CachePort;

  constructor(
    public readonly config: AppConfig,
    public readonly db: Db,
    private readonly overrides: ContainerOverrides = {},
    private readonly logger?: ContainerLogger,
  ) {}

  get auth(): AuthProvider {
    this._auth ??= this.overrides.auth ?? new LocalAuthProvider();
    return this._auth;
  }

  get notifier(): Notifier {
    this._notifier ??= this.overrides.notifier ?? new ConsoleNotifier();
    return this._notifier;
  }

  /**
   * Redis when `REDIS_URL` is set, otherwise a no-op. Callers cannot tell the
   * difference: a NoopCache is indistinguishable from a permanently cold one.
   */
  get cache(): CachePort {
    this._cache ??=
      this.overrides.cache ??
      (this.config.redisUrl
        ? new RedisCache(this.config.redisUrl, (err) =>
            this.logger?.warn({ err: err.message }, 'cache unavailable, serving from db'),
          )
        : new NoopCache());
    return this._cache;
  }

  /** Release adapters that hold a socket. Only touches what was constructed. */
  async close(): Promise<void> {
    await this._cache?.close();
  }
}
