import type { FastifyInstance } from 'fastify';
import { ArticleService } from '../modules/articles/service.js';
import { WorkspaceRepository } from '../modules/workspaces/repository.js';

export const STALE_DRAFT_DIGEST = 'stale-draft-digest';

/**
 * Jobs ring: binds a service to the scheduler port. Same rule as a route
 * handler — no business logic here, just "when, and for whom".
 *
 * Jobs are cross-tenant (there is no request to take a workspace from), so the
 * run fans out over `WorkspaceRepository.listIds()` and calls the service once
 * per workspace. One workspace failing must not skip the rest, so each is
 * caught and logged on its own.
 */
export function registerJobs(app: FastifyInstance): void {
  const { container } = app;
  const articles = new ArticleService(container);
  const workspaces = new WorkspaceRepository(container.db);

  container.scheduler.schedule(
    STALE_DRAFT_DIGEST,
    container.config.jobs.staleDraftCron,
    async () => {
      const now = new Date();
      for (const workspaceId of await workspaces.listIds()) {
        try {
          const reported = await articles.staleDraftDigest(workspaceId, now);
          if (reported > 0) {
            app.log.info({ job: STALE_DRAFT_DIGEST, workspaceId, reported }, 'digest sent');
          }
        } catch (err) {
          app.log.error(
            { job: STALE_DRAFT_DIGEST, workspaceId, err: (err as Error).message },
            'digest failed for workspace',
          );
        }
      }
    },
  );
}
