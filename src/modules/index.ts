import type { FastifyPluginAsync } from 'fastify';
import articles from './articles/routes.js';
import comments from './comments/routes.js';

/**
 * Static module registry. Deliberately not `@fastify/autoload`: native dynamic
 * `import()` of `.ts` files is not portable across tsx / tsc / vitest.
 *
 * Add a module here and app.ts registers it.
 */
export const modules: Record<string, FastifyPluginAsync> = {
  articles,
  comments,
};
