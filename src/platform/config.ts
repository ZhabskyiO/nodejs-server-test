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
});

export type AppConfig = {
  databaseUrl: string;
  apiPort: number;
  webPort: number;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  /** Allowed CORS origin for a browser client. */
  webOrigin: string;
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
  };
}
