import type { FastifyInstance } from 'fastify';
import { buildApp, type BuildAppOptions } from '../../src/app.js';
import { loadConfig, type AppConfig } from '../../src/platform/config.js';
import type { Db } from '../../src/db/client.js';

/** Test config: silent logs, rate limit off, DB URL never dialled. */
export function testConfig(): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://unused:unused@localhost:1/unused',
  });
}

/**
 * A Db stand-in whose every entrypoint throws. Hermetic route tests use it to
 * prove that no DB call happens before validation, and that driver failures are
 * not leaked to the client.
 */
export function explodingDb(message = 'connection refused: password=hunter2'): Db {
  const boom = () => {
    throw new Error(message);
  };
  return { select: boom, insert: boom, update: boom, delete: boom, execute: boom } as unknown as Db;
}

/** buildApp() with the test config + an exploding DB unless one is supplied. */
export async function buildTestApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  return buildApp({ config: testConfig(), db: opts.db ?? explodingDb(), ...opts });
}
