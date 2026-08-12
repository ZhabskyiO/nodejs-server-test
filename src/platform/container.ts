import type { Db } from '../db/client.js';
import type { AppConfig } from './config.js';
import type { AuthProvider, Notifier, Scheduler } from '../adapters/ports.js';
import { LocalAuthProvider } from '../adapters/auth/local.js';
import { ConsoleNotifier } from '../adapters/notifier/console.js';
import { NodeCronScheduler, type JobLogger } from '../adapters/scheduler/node-cron.js';

/**
 * Test seams. `buildApp({ overrides })` swaps a real adapter for a fake without
 * touching any service.
 */
export interface ContainerOverrides {
  auth?: AuthProvider;
  notifier?: Notifier;
  scheduler?: Scheduler;
}

/** Fallback for a container built outside Fastify (scripts, direct construction). */
const consoleLogger: JobLogger = {
  info: (obj, msg) => console.log(msg, obj),
  error: (obj, msg) => console.error(msg, obj),
};

/**
 * Composition root. The ONLY place that constructs adapters. Services receive
 * the container and reach infrastructure through it — they never import an SDK
 * (or `process.env`) directly.
 */
export class Container {
  private _auth?: AuthProvider;
  private _notifier?: Notifier;
  private _scheduler?: Scheduler;

  constructor(
    public readonly config: AppConfig,
    public readonly db: Db,
    private readonly overrides: ContainerOverrides = {},
    private readonly logger: JobLogger = consoleLogger,
  ) {}

  get auth(): AuthProvider {
    this._auth ??= this.overrides.auth ?? new LocalAuthProvider();
    return this._auth;
  }

  get notifier(): Notifier {
    this._notifier ??= this.overrides.notifier ?? new ConsoleNotifier();
    return this._notifier;
  }

  get scheduler(): Scheduler {
    this._scheduler ??= this.overrides.scheduler ?? new NodeCronScheduler(this.logger);
    return this._scheduler;
  }

  /**
   * Release anything holding the process open. Only touches adapters that were
   * actually constructed — reading the getter here would arm a scheduler that
   * nothing ever used.
   */
  async close(): Promise<void> {
    await this._scheduler?.stop();
  }
}
