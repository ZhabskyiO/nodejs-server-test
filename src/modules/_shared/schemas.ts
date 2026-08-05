import { z } from 'zod';

/** `:id` route param — every resource uses uuid PKs. */
export const IdParams = z.object({ id: z.string().uuid() });

/** Shared pagination querystring. Coerced from strings, bounded server-side. */
export const PageQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/** Envelope every list endpoint returns. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
  });
}

/** Error body produced by the global error handler. */
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
