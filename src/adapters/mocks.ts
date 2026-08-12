import type {
  ArticlePublishedEvent,
  AuthProvider,
  Notifier,
  RequestIdentity,
  Scheduler,
  StaleDraftsEvent,
} from './ports.js';
import { DEFAULT_WORKSPACE_ID, SYSTEM_USER_ID } from './auth/local.js';

/** Records what it was told, so tests can assert on outbound effects. */
export class MockNotifier implements Notifier {
  readonly published: ArticlePublishedEvent[] = [];
  readonly staleDrafts: StaleDraftsEvent[] = [];

  async articlePublished(event: ArticlePublishedEvent): Promise<void> {
    this.published.push(event);
  }

  async staleDraftsPending(event: StaleDraftsEvent): Promise<void> {
    this.staleDrafts.push(event);
  }
}

export interface ScheduledJob {
  name: string;
  expression: string;
  run: () => Promise<void>;
}

/**
 * Holds registrations instead of arming a timer, so a test can assert on what
 * would run — and `trigger()` it on demand rather than waiting for a clock.
 */
export class MockScheduler implements Scheduler {
  readonly jobs: ScheduledJob[] = [];
  stopped = false;

  schedule(name: string, expression: string, run: () => Promise<void>): void {
    this.jobs.push({ name, expression, run });
  }

  async trigger(name: string): Promise<void> {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) throw new Error(`No job registered under "${name}"`);
    await job.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

/** Lets a test pin the tenant (e.g. to prove cross-workspace reads are blocked). */
export class MockAuthProvider implements AuthProvider {
  constructor(
    private identity: RequestIdentity = {
      workspaceId: DEFAULT_WORKSPACE_ID,
      userId: SYSTEM_USER_ID,
    },
  ) {}

  async resolve(): Promise<RequestIdentity> {
    return this.identity;
  }
}
