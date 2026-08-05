import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { articles } from './articles';
import { createdAt } from './_shared';

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    articleId: uuid('article_id')
      .references(() => articles.id, { onDelete: 'cascade' })
      .notNull(),
    /** Free-text author name — comments are anonymous in this fixture. */
    author: text('author').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('comments_article_created_idx').on(t.articleId, t.createdAt)],
);
