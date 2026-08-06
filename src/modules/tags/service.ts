import type { Container } from '../../platform/container.js';
import { TagRepository, type ListPage, type TagCountRow } from './repository.js';

export interface TagList {
  items: TagCountRow[];
  page: number;
  perPage: number;
  totalCount: number;
}

/**
 * Tags application layer. Read-only for now: tags are created implicitly by
 * writing an article, so there is nothing to mutate here.
 */
export class TagService {
  private repo: TagRepository;

  constructor(container: Container) {
    this.repo = new TagRepository(container.db);
  }

  async list(workspaceId: string, page: ListPage): Promise<TagList> {
    const [items, totalCount] = await Promise.all([
      this.repo.list(workspaceId, page),
      this.repo.count(workspaceId),
    ]);
    return { items, page: page.page, perPage: page.limit, totalCount };
  }
}
