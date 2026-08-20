import type { FastifyInstance } from 'fastify';
import { ArticleService } from '../modules/articles/service.js';
import { WorkspaceRepository } from '../modules/workspaces/repository.js';
import type { JobLogger } from '../adapters/scheduler/node-cron.js';
import type { Container } from './container.js';

export const STALE_DRAFT_DIGEST = 'stale-draft-digest';

/**
 * Job registry: name → cron expression. This table is the schedule of record;
 * `STALE_DRAFT_CRON` in the environment only overrides it, and the scheduled
 * GitHub Actions workflow (`.github/workflows/stale-draft-digest.yml`) mirrors
 * the same expression for the hosted run.
 */
export const CRON_SCHEDULES = {
  /** Every day at 03:00 — quiet hours, well clear of the seed/migrate window. */
  [STALE_DRAFT_DIGEST]: '0 3 * * *',
} as const;

/**
 * The digest run itself, shared by both triggers: the in-process cron
 * (`registerJobs`) and the one-shot entrypoint `src/jobs/stale-draft-digest.ts`
 * that the scheduled workflow invokes.
 *
 * Jobs are cross-tenant (there is no request to take a workspace from), so this
 * fans out over `WorkspaceRepository.listIds()` and calls the service once per
 * workspace. One workspace failing must not skip the rest, so each is caught
 * and logged on its own.
 *
 * Returns the number of workspaces a digest was actually sent for.
 */
export async function runStaleDraftDigest(container: Container, log: JobLogger): Promise<number> {
  const articles = new ArticleService(container);
  const workspaces = new WorkspaceRepository(container.db);
  const now = new Date();
  let sent = 0;

  for (const workspaceId of await workspaces.listIds()) {
    try {
      const reported = await articles.staleDraftDigest(workspaceId, now);
      if (reported > 0) {
        sent++;
        log.info({ job: STALE_DRAFT_DIGEST, workspaceId, reported }, 'digest sent');
      }
    } catch (err) {
      log.error(
        { job: STALE_DRAFT_DIGEST, workspaceId, err: (err as Error).message },
        'digest failed for workspace',
      );
    }
  }
  return sent;
}

/**
 * Jobs ring: binds a service to the scheduler port. Same rule as a route
 * handler — no business logic here, just "when, and for whom".
 */
export function registerJobs(app: FastifyInstance): void {
  const { container } = app;
  const schedule = container.config.jobs.staleDraftCron || CRON_SCHEDULES[STALE_DRAFT_DIGEST];

  // cron: '0 3 * * *' — stale-draft-digest
  container.scheduler.schedule(STALE_DRAFT_DIGEST, schedule, () =>
    runStaleDraftDigest(container, app.log).then(() => undefined),
  );
}
