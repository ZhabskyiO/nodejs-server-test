import type { Db } from '../db/client.js';
import type { AppConfig } from './config.js';
import type { AuthProvider, Notifier } from '../adapters/ports.js';
import { LocalAuthProvider } from '../adapters/auth/local.js';
import { ConsoleNotifier } from '../adapters/notifier/console.js';

/**
 * Test seams. `buildApp({ overrides })` swaps a real adapter for a fake without
 * touching any service.
 */
export interface ContainerOverrides {
  auth?: AuthProvider;
  notifier?: Notifier;
}

/**
 * Composition root. The ONLY place that constructs adapters. Services receive
 * the container and reach infrastructure through it — they never import an SDK
 * (or `process.env`) directly.
 */
export class Container {
  private _auth?: AuthProvider;
  private _notifier?: Notifier;

  constructor(
    public readonly config: AppConfig,
    public readonly db: Db,
    private readonly overrides: ContainerOverrides = {},
  ) {}

  get auth(): AuthProvider {
    this._auth ??= this.overrides.auth ?? new LocalAuthProvider();
    return this._auth;
  }

  get notifier(): Notifier {
    this._notifier ??= this.overrides.notifier ?? new ConsoleNotifier();
    return this._notifier;
  }
}
