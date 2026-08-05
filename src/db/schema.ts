/**
 * Schema barrel. Import tables from here (`import * as t from '../../db/schema.js'`)
 * and pass the `schema` object to drizzle() so relational typing works.
 *
 * NOTE: this file and everything under `./schema/` use EXTENSIONLESS relative
 * imports — the rest of the codebase uses `.js`. drizzle-kit loads the schema
 * through esbuild-register (CJS), which cannot map a `.js` specifier back to
 * the `.ts` source, so `pnpm db:generate` fails with MODULE_NOT_FOUND otherwise.
 */
export * from './schema/core';
export * from './schema/articles';
export * from './schema/comments';

import { workspaces, users } from './schema/core';
import { articles } from './schema/articles';
import { comments } from './schema/comments';

export const schema = { workspaces, users, articles, comments };
