import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import { ArticleRepository, type ArticleRow, type ListFilters } from './repository.js';
import {
  articleCacheKey,
  deserializeArticleRow,
  normalizeTags,
  serializeArticleRow,
  slugify,
} from './helpers.js';
import { MAX_SLUG_ATTEMPTS, type ArticleStatus } from './constants.js';

export interface CreateArticleInput {
  title: string;
  body: string;
  tags?: string[];
  status?: ArticleStatus;
}

export interface UpdateArticleInput {
  title?: string;
  body?: string;
  tags?: string[];
}

export interface ArticleList {
  items: ArticleRow[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Articles application layer: business rules + orchestration. Reaches the DB
 * only via ArticleRepository and the outside world only via the container's
 * ports.
 */
export class ArticleService {
  private repo: ArticleRepository;

  constructor(private container: Container) {
    this.repo = new ArticleRepository(container.db);
  }

  async list(workspaceId: string, filters: ListFilters): Promise<ArticleList> {
    const [items, total] = await Promise.all([
      this.repo.list(workspaceId, filters),
      this.repo.count(workspaceId, filters),
    ]);
    return { items, page: filters.page, limit: filters.limit, total };
  }

  /**
   * Read-through cache. A miss (or an unreachable Redis, which the adapter
   * reports as a miss) falls back to the DB, so behaviour is identical with the
   * cache off — only the number of round-trips changes.
   *
   * 404s are deliberately not cached: an article that appears later would keep
   * returning 404 for the rest of the TTL.
   */
  async getById(workspaceId: string, id: string): Promise<ArticleRow> {
    const key = articleCacheKey(workspaceId, id);
    const cached = await this.container.cache.get(key);
    if (cached) {
      const row = deserializeArticleRow(cached);
      if (row) return row;
    }
    const row = await this.readFresh(workspaceId, id);
    await this.container.cache.set(
      key,
      serializeArticleRow(row),
      this.container.config.cacheTtlSeconds,
    );
    return row;
  }

  /** Bypasses the cache — for callers that must not act on a stale row. */
  private async readFresh(workspaceId: string, id: string): Promise<ArticleRow> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) throw new NotFoundError('Article not found');
    return row;
  }

  async create(
    workspaceId: string,
    userId: string,
    input: CreateArticleInput,
  ): Promise<ArticleRow> {
    const slug = await this.uniqueSlug(workspaceId, slugify(input.title));
    return this.repo.insert({
      workspaceId,
      authorId: userId,
      slug,
      title: input.title,
      body: input.body,
      status: input.status ?? 'draft',
      tags: normalizeTags(input.tags),
    });
  }

  async update(workspaceId: string, id: string, input: UpdateArticleInput): Promise<ArticleRow> {
    // The slug is intentionally NOT recomputed on rename: it is part of the
    // article's public URL and rewriting it would break existing links.
    const row = await this.repo.update(workspaceId, id, {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.body !== undefined && { body: input.body }),
      ...(input.tags !== undefined && { tags: normalizeTags(input.tags) }),
    });
    if (!row) throw new NotFoundError('Article not found');
    await this.invalidate(workspaceId, id);
    return row;
  }

  async publish(workspaceId: string, id: string): Promise<ArticleRow> {
    // readFresh, not getById: the already-published check is a correctness
    // guard, and a cached row could be up to one TTL behind reality.
    const existing = await this.readFresh(workspaceId, id);
    if (existing.status === 'published') {
      throw new ConflictError('Article is already published', { articleId: id });
    }
    const row = await this.repo.markPublished(workspaceId, id, new Date());
    if (!row) throw new NotFoundError('Article not found');
    await this.invalidate(workspaceId, id);
    await this.container.notifier.articlePublished({
      articleId: row.id,
      workspaceId: row.workspaceId,
      title: row.title,
      slug: row.slug,
    });
    return row;
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const removed = await this.repo.remove(workspaceId, id);
    if (!removed) throw new NotFoundError('Article not found');
    await this.invalidate(workspaceId, id);
  }

  /**
   * Drop the cached row after a write. Invalidating (rather than rewriting) the
   * key keeps the DB the single source of truth: the next read repopulates it.
   */
  private async invalidate(workspaceId: string, id: string): Promise<void> {
    await this.container.cache.del(articleCacheKey(workspaceId, id));
  }

  /**
   * Resolve slug collisions within the workspace: `hello`, `hello-2`, `hello-3`…
   * One query fetches the taken prefixes so this doesn't loop against the DB.
   */
  private async uniqueSlug(workspaceId: string, base: string): Promise<string> {
    const taken = new Set(await this.repo.slugsLike(workspaceId, base));
    if (!taken.has(base)) return base;
    for (let n = 2; n <= MAX_SLUG_ATTEMPTS; n++) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
    // Pathological case (50+ articles with the same title): fall back to a
    // timestamp suffix rather than failing the request.
    return `${base}-${Date.now()}`;
  }
}
