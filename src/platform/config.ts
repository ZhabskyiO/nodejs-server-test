import 'dotenv/config';
import { z } from 'zod';

/**
 * Central, zod-validated environment config. Loaded once at startup and passed
 * down through the DI container — feature code never reads `process.env`.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().default('postgres://apitest:apitest@localhost:5433/apitest'),
  API_PORT: z.coerce.number().int().default(3005),
  WEB_PORT: z.coerce.number().int().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // `.env.example` ships `LOG_LEVEL=` empty; an empty string is not a valid enum
  // member, so coerce '' → undefined to fall through to the default below.
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
  // Unset (or empty, as `.env.example` ships it) means "no cache": the container
  // falls back to NoopCache, so Redis stays an opt-in deployment concern.
  REDIS_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(60),
});

export type AppConfig = {
  databaseUrl: string;
  apiPort: number;
  webPort: number;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  /** Allowed CORS origin for a browser client. */
  webOrigin: string;
  /** Undefined disables the read cache entirely. */
  redisUrl?: string;
  /** TTL applied to every cached article read. */
  cacheTtlSeconds: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  return {
    databaseUrl: parsed.DATABASE_URL,
    apiPort: parsed.API_PORT,
    webPort: parsed.WEB_PORT,
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'test' ? 'silent' : 'info'),
    webOrigin: `http://localhost:${parsed.WEB_PORT}`,
    redisUrl: parsed.REDIS_URL,
    cacheTtlSeconds: parsed.CACHE_TTL_SECONDS,
  };
}
