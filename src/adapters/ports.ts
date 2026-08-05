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

/** Fire-and-forget outbound notification (stand-in for email/webhook/queue). */
export interface Notifier {
  articlePublished(event: ArticlePublishedEvent): Promise<void>;
}
