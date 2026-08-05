import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError, IdParams, PageQuery, paginated } from '../_shared/schemas.js';
import { getContext } from '../_shared/context.js';
import { ArticleService } from './service.js';
import { toArticleDto } from './helpers.js';
import { ARTICLE_STATUSES, MAX_BODY_LENGTH, MAX_TAGS, MAX_TITLE_LENGTH } from './constants.js';

const TagSchema = z.string().min(1).max(64);

const CreateArticleBody = z.object({
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  body: z.string().min(1).max(MAX_BODY_LENGTH),
  tags: z.array(TagSchema).max(MAX_TAGS).optional(),
  status: z.enum(ARTICLE_STATUSES).optional(),
});

const UpdateArticleBody = z
  .object({
    title: z.string().min(1).max(MAX_TITLE_LENGTH).optional(),
    body: z.string().min(1).max(MAX_BODY_LENGTH).optional(),
    tags: z.array(TagSchema).max(MAX_TAGS).optional(),
  })
  .refine((v) => Object.values(v).some((field) => field !== undefined), {
    message: 'At least one field must be provided',
  });

const ListArticlesQuery = PageQuery.extend({
  status: z.enum(ARTICLE_STATUSES).optional(),
  tag: TagSchema.optional(),
  /** Case-insensitive substring match over title + body. */
  q: z.string().min(1).max(200).optional(),
});

const ArticleResponse = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  body: z.string(),
  status: z.string(),
  tags: z.array(z.string()),
  authorId: z.string().uuid(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const DeletedResponse = z.object({ deleted: z.string().uuid() });

/**
 * Articles transport layer: parse/validate, map status codes, delegate. No
 * business logic and no DB access here.
 */
export default async function articlesRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ArticleService(app.container);

  app.post(
    '/articles',
    {
      schema: {
        body: CreateArticleBody,
        response: { 201: ArticleResponse, 422: ApiError },
      },
    },
    async (req, reply) => {
      const { workspaceId, userId } = await getContext(app.container, req);
      const article = await service.create(workspaceId, userId, req.body);
      reply.status(201);
      return toArticleDto(article);
    },
  );

  app.get(
    '/articles',
    {
      schema: {
        querystring: ListArticlesQuery,
        response: { 200: paginated(ArticleResponse) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.list(workspaceId, req.query);
      return {
        items: result.items.map(toArticleDto),
        page: result.page,
        limit: result.limit,
        total: result.total,
      };
    },
  );

  app.get(
    '/articles/:id',
    {
      schema: {
        params: IdParams,
        response: { 200: ArticleResponse, 404: ApiError },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return toArticleDto(await service.getById(workspaceId, req.params.id));
    },
  );

  app.patch(
    '/articles/:id',
    {
      schema: {
        params: IdParams,
        body: UpdateArticleBody,
        response: { 200: ArticleResponse, 404: ApiError, 422: ApiError },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return toArticleDto(await service.update(workspaceId, req.params.id, req.body));
    },
  );

  app.post(
    '/articles/:id/publish',
    {
      schema: {
        params: IdParams,
        response: { 200: ArticleResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return toArticleDto(await service.publish(workspaceId, req.params.id));
    },
  );

  app.delete(
    '/articles/:id',
    {
      schema: {
        params: IdParams,
        response: { 200: DeletedResponse, 404: ApiError },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.remove(workspaceId, req.params.id);
      return { deleted: req.params.id };
    },
  );
}
