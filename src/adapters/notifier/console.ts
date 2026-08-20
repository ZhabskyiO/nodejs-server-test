import type { ArticlePublishedEvent, Notifier, StaleDraftsEvent } from '../ports.js';

/**
 * Stand-in for a real outbound channel (email / webhook / queue). Writing to
 * stdout keeps the fixture dependency-free while still giving services an
 * external effect to go through the container for.
 */
export class ConsoleNotifier implements Notifier {
  async articlePublished(event: ArticlePublishedEvent): Promise<void> {
    console.log(`[notifier] article published: ${event.slug} (${event.articleId})`);
  }

  async staleDraftsPending(event: StaleDraftsEvent): Promise<void> {
    console.log(
      `[notifier] stale drafts pending: ${event.lines.length} in workspace ${event.workspaceId}`,
    );
    for (const line of event.lines) console.log(`[notifier]   ${line}`);
  }
}
