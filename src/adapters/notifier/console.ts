import type { ArticlePublishedEvent, Notifier } from '../ports.js';

/**
 * Stand-in for a real outbound channel (email / webhook / queue). Writing to
 * stdout keeps the fixture dependency-free while still giving services an
 * external effect to go through the container for.
 */
export class ConsoleNotifier implements Notifier {
  async articlePublished(event: ArticlePublishedEvent): Promise<void> {
    console.log(`[notifier] article published: ${event.slug} (${event.articleId})`);
  }
}
