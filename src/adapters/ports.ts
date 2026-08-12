/**
 * Ports — the interfaces the application layer is allowed to depend on.
 *
 * Services talk to these, never to a concrete SDK. Implementations live in
 * `src/adapters/<kind>/` and are wired in `platform/container.ts`.
 */

export interface RequestIdentity {
  workspaceId: string;
  userId: string;
}

/** Resolves the tenant + actor for a request. */
export interface AuthProvider {
  resolve(headers: Record<string, string | string[] | undefined>): Promise<RequestIdentity>;
}

export interface ArticlePublishedEvent {
  articleId: string;
  workspaceId: string;
  title: string;
  slug: string;
}

export interface StaleDraftsEvent {
  workspaceId: string;
  /** One line per stale draft, oldest first — already rendered for the digest. */
  lines: string[];
}

/** Fire-and-forget outbound notification (stand-in for email/webhook/queue). */
export interface Notifier {
  articlePublished(event: ArticlePublishedEvent): Promise<void>;
  staleDraftsPending(event: StaleDraftsEvent): Promise<void>;
}

/**
 * Recurring background work. The expression is standard cron ('0 3 * * *');
 * `run` is expected to handle its own failures, and the adapter must not let
 * one rejected run take the process down.
 */
export interface Scheduler {
  schedule(name: string, expression: string, run: () => Promise<void>): void;
  stop(): Promise<void>;
}
