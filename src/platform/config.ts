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
  // Background jobs. Off under test regardless of this flag — see below.
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  STALE_DRAFT_CRON: z.string().default('0 3 * * *'),
  STALE_DRAFT_AFTER_DAYS: z.coerce.number().int().min(0).default(14),
  /** Per-workspace cap on one digest, so a neglected workspace can't produce a huge run. */
  STALE_DRAFT_LIMIT: z.coerce.number().int().positive().default(50),
});

export type AppConfig = {
  databaseUrl: string;
  apiPort: number;
  webPort: number;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  /** Allowed CORS origin for a browser client. */
  webOrigin: string;
  jobs: JobsConfig;
};

export type JobsConfig = {
  /** Never true under `NODE_ENV=test`: a live timer would outlive the suite. */
  enabled: boolean;
  staleDraftCron: string;
  staleDraftAfterDays: number;
  staleDraftLimit: number;
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
    jobs: {
      enabled: parsed.JOBS_ENABLED && parsed.NODE_ENV !== 'test',
      staleDraftCron: parsed.STALE_DRAFT_CRON,
      staleDraftAfterDays: parsed.STALE_DRAFT_AFTER_DAYS,
      staleDraftLimit: parsed.STALE_DRAFT_LIMIT,
    },
  };
}
