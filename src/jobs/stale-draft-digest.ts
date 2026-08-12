/**
 * One-shot entrypoint for the `stale-draft-digest` job — cron `0 3 * * *`.
 *
 * Two triggers, one implementation (`runStaleDraftDigest`): the API process
 * schedules it in-process through the `Scheduler` port, and
 * `.github/workflows/stale-draft-digest.yml` runs this script on the same
 * schedule for deployments where the API is scaled to zero or runs more than
 * one replica (in-process cron would fire once per replica).
 *
 *   pnpm job:stale-drafts
 *
 * Exits non-zero only if the run could not start at all — a single workspace
 * failing is logged and skipped inside the run.
 */
import { loadConfig } from '../platform/config.js';
import { createDb } from '../db/client.js';
import { Container } from '../platform/container.js';
import { runStaleDraftDigest, STALE_DRAFT_DIGEST } from '../platform/jobs.js';

const log = {
  info: (obj: object, msg: string) => console.log(msg, JSON.stringify(obj)),
  error: (obj: object, msg: string) => console.error(msg, JSON.stringify(obj)),
};

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = createDb(config.databaseUrl, { max: 2 });
  // No scheduler is ever constructed here: this process runs the job once and
  // exits, so arming an in-process cron would be a leak, not a feature.
  const container = new Container(config, handle.db);

  try {
    const sent = await runStaleDraftDigest(container, log);
    log.info({ job: STALE_DRAFT_DIGEST, workspaces: sent }, 'digest run finished');
  } finally {
    await container.close();
    await handle.close();
  }
}

main().catch((err) => {
  console.error(`[${STALE_DRAFT_DIGEST}] run failed:`, err);
  process.exit(1);
});
