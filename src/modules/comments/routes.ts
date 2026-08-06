import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError, IdParams, PageQuery, paginated } from '../_shared/schemas.js';
import { getContext } from '../_shared/context.js';
import { CommentService, toCommentDto } from './service.js';

const MAX_AUTHOR_LENGTH = 80;
const MAX_COMMENT_LENGTH = 5_000;

const CreateCommentBody = z.object({
  author: z.string().min(1).max(MAX_AUTHOR_LENGTH),
  body: z.string().min(1).max(MAX_COMMENT_LENGTH),
});

const CommentResponse = z.object({
  id: z.string().uuid(),
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

const DeletedResponse = z.object({ id: z.string().uuid(), deleted: z.boolean() });

/** Nested listing is superseded by the flat `GET /comments?articleId=` reader. */
const NESTED_LIST_ROUTE = '/articles/:id/comments';
const NESTED_LIST_SUNSET = 'Sat, 15 Aug 2026 00:00:00 GMT';

/**
 * Comments transport layer. Creation/listing are nested under the parent
 * article; deletion is addressed by comment id.
 */
export default async function commentsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CommentService(app.container);

  app.addHook('onSend', async (req, reply) => {
    if (req.method === 'GET' && req.routeOptions.url === NESTED_LIST_ROUTE) {
      reply.header('Deprecation', 'true');
      reply.header('Sunset', NESTED_LIST_SUNSET);
    }
  });

  app.post(
    '/articles/:id/comments',
    {
      schema: {
        params: IdParams,
        body: CreateCommentBody,
        response: { 201: CommentResponse, 404: ApiError, 422: ApiError },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const comment = await service.create(workspaceId, req.params.id, req.body);
      reply.status(201);
      return toCommentDto(comment);
    },
  );

  app.get(
    '/articles/:id/comments',
    {
      schema: {
        params: IdParams,
        querystring: PageQuery,
        response: { 200: paginated(CommentResponse), 404: ApiError },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.listForArticle(workspaceId, req.params.id, req.query);
      return {
        items: result.items.map(toCommentDto),
        page: result.page,
        limit: result.limit,
        total: result.total,
      };
    },
  );

  app.delete(
    '/comments/:id',
    {
      schema: {
        params: IdParams,
        response: { 200: DeletedResponse, 404: ApiError },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.remove(workspaceId, req.params.id);
      return { id: req.params.id, deleted: true };
    },
  );
}
