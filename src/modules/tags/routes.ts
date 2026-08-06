import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PageQuery } from '../_shared/schemas.js';
import { getContext } from '../_shared/context.js';
import { TagService } from './service.js';

const TagCountResponse = z.object({
  name: z.string(),
  count: z.number().int(),
});

const TagListResponse = z.object({
  items: z.array(TagCountResponse),
  page: z.number().int(),
  perPage: z.number().int(),
  totalCount: z.number().int(),
});

/**
 * Tags transport layer. Browsing surface for the tag filter on `GET /articles`.
 */
export default async function tagsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new TagService(app.container);

  app.get(
    '/tags',
    {
      schema: {
        querystring: PageQuery,
        response: { 200: TagListResponse },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId, req.query);
    },
  );
}
