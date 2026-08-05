import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import { ArticleRepository, type ArticleRow, type ListFilters } from './repository.js';
import { normalizeTags, slugify } from './helpers.js';
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

  async getById(workspaceId: string, id: string): Promise<ArticleRow> {
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
    return row;
  }

  async publish(workspaceId: string, id: string): Promise<ArticleRow> {
    const existing = await this.getById(workspaceId, id);
    if (existing.status === 'published') {
      throw new ConflictError('Article is already published', { articleId: id });
    }
    const row = await this.repo.markPublished(workspaceId, id, new Date());
    if (!row) throw new NotFoundError('Article not found');
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
