import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { workspaces, users } from './core';
import { createdAt, updatedAt } from './_shared';

export const articles = pgTable(
  'articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    authorId: uuid('author_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** URL-safe title, unique per workspace. */
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** 'draft' | 'published' — kept as text so a migration isn't needed to add states. */
    status: text('status').notNull().default('draft'),
    tags: text('tags').array().notNull().default([]),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('articles_ws_slug_uq').on(t.workspaceId, t.slug),
    // Supports the default list query: filter by workspace (+ status), newest first.
    index('articles_ws_status_created_idx').on(t.workspaceId, t.status, t.createdAt),
  ],
);
