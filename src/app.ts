import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {
  validatorCompiler,
  serializerCompiler,
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { loadConfig, type AppConfig } from './platform/config.js';
import { createDb, type Db } from './db/client.js';
import { Container, type ContainerOverrides } from './platform/container.js';
import { AppError } from './platform/errors.js';
import { modules } from './modules/index.js';

// Attach the DI container to the instance (and therefore to every route).
declare module 'fastify' {
  interface FastifyInstance {
    container: Container;
  }
}

export interface BuildAppOptions {
  config?: AppConfig;
  db?: Db;
  overrides?: ContainerOverrides;
}

/**
 * buildApp() — exported so tests can use `app.inject()` without binding a port.
 *
 * Registration order matters: zod compilers → container → security plugins →
 * health routes → error handler (BEFORE modules, so encapsulated module plugins
 * inherit it) → feature modules.
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  const handle = opts.db ? null : createDb(config.databaseUrl);
  const db = opts.db ?? handle!.db;

  const app = Fastify({
    // Explicit 1MB cap on request bodies — articles and comments are small.
    bodyLimit: 1_048_576,
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            transport:
              config.nodeEnv === 'development'
                ? { target: 'pino-pretty', options: { colorize: true } }
                : undefined,
          },
  });

  // Use zod schemas directly for request validation + response serialization.
  // Routes opt in per-module via `app.withTypeProvider<ZodTypeProvider>()`.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('container', new Container(config, db, opts.overrides, app.log));

  // Security headers. The API serves JSON only, so the default CSP is fine.
  await app.register(helmet);
  await app.register(cors, { origin: [config.webOrigin], credentials: true });

  // Global rate limit. Disabled under test so suites can hammer inject().
  if (config.nodeEnv !== 'test') {
    await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  }

  // Liveness (no DB, no rate limit).
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));

  // Readiness — cheap `SELECT 1`. 503 (not 500) so orchestrators read it as
  // "not ready yet" rather than a crash.
  app.get('/health/ready', { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { ready: true };
    } catch (err) {
      app.log.warn({ err: (err as Error).message }, 'readiness check failed: db unreachable');
      return reply.status(503).send({ ready: false });
    }
  });

  // Structured error handler → stable envelope { error: { code, message, details } }.
  app.setErrorHandler((err: unknown, _req, reply) => {
    // Request validation failure from the zod type provider (schema.body/params).
    if (hasZodFastifySchemaValidationErrors(err)) {
      reply.status(422).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: err.validation,
        },
      });
      return;
    }
    // Response failed its own serialization schema — never leak the raw object;
    // log it and return a generic 500.
    if (isResponseSerializationError(err)) {
      app.log.error({ err }, 'response serialization failed');
      reply.status(500).send({ error: { code: 'internal_error', message: 'Internal error' } });
      return;
    }
    if (err instanceof z.ZodError) {
      reply.status(422).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: err.issues,
        },
      });
      return;
    }
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    app.log.error(err);
    const e = err as { statusCode?: number; message?: string };
    // Unknown failures return a generic message: an internal error string (a
    // driver error, a stack) must not reach the client.
    const statusCode = e.statusCode ?? 500;
    reply.status(statusCode).send({
      error: {
        code: statusCode >= 500 ? 'internal_error' : 'bad_request',
        message: statusCode >= 500 ? 'Internal error' : (e.message ?? 'Bad request'),
      },
    });
  });

  // Register feature modules from the static registry (src/modules/index.ts).
  for (const plugin of Object.values(modules)) {
    await app.register(plugin);
  }

  // Release adapter sockets (Redis) on shutdown, whoever owns the db handle.
  app.addHook('onClose', async () => app.container.close());

  // Close the db handle we created (not one passed in by a test).
  if (handle) app.addHook('onClose', async () => handle.close());

  return app;
}
