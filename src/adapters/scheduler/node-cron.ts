import cron, { type ScheduledTask } from 'node-cron';
import type { Scheduler } from '../ports.js';

/** Just enough of the Fastify logger for this adapter — keeps pino out of the port. */
export interface JobLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/**
 * The only file that imports `node-cron`.
 *
 * A rejected run is logged and swallowed: an unhandled rejection inside a timer
 * would take the API process down with it, and a missed digest is not worth
 * that. `noOverlap` means a run that outlives its window is not stacked on by
 * the next tick.
 */
export class NodeCronScheduler implements Scheduler {
  private tasks: ScheduledTask[] = [];

  constructor(private log: JobLogger) {}

  schedule(name: string, expression: string, run: () => Promise<void>): void {
    if (!cron.validate(expression)) {
      throw new Error(`Invalid cron expression for job "${name}": ${expression}`);
    }
    const task = cron.schedule(
      expression,
      async () => {
        const startedAt = Date.now();
        try {
          await run();
          this.log.info({ job: name, ms: Date.now() - startedAt }, 'job finished');
        } catch (err) {
          this.log.error({ job: name, err: (err as Error).message }, 'job failed');
        }
      },
      { name, noOverlap: true },
    );
    this.tasks.push(task);
    this.log.info({ job: name, expression }, 'job scheduled');
  }

  async stop(): Promise<void> {
    await Promise.all(this.tasks.map((task) => task.stop()));
    this.tasks = [];
  }
}
