import { timestamp } from 'drizzle-orm/pg-core';

/** Shared `created_at` column: timestamptz, defaulted server-side, never null. */
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).defaultNow().notNull();

/** Shared `updated_at` column. Bumped explicitly by repositories on update. */
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();
