import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { ArticleRepository } from '../articles/repository.js';
import { CommentRepository, type CommentRow, type ListPage } from './repository.js';

export interface CreateCommentInput {
  author: string;
  body: string;
}

export interface CommentList {
  items: CommentRow[];
  page: number;
  limit: number;
  total: number;
}

export interface CommentDto {
  id: string;
  articleId: string;
  author: string;
  body: string;
  createdAt: string;
}

export function toCommentDto(row: CommentRow): CommentDto {
  return {
    id: row.id,
    articleId: row.articleId,
    author: row.author,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Comments application layer. Reads the parent article through the articles
 * repository so a comment can never be attached to another workspace's article.
 */
export class CommentService {
  private repo: CommentRepository;
  private articles: ArticleRepository;

  constructor(container: Container) {
    this.repo = new CommentRepository(container.db);
    this.articles = new ArticleRepository(container.db);
  }

  async listForArticle(
    workspaceId: string,
    articleId: string,
    page: ListPage,
  ): Promise<CommentList> {
    await this.requireArticle(workspaceId, articleId);
    const [items, total] = await Promise.all([
      this.repo.listByArticle(workspaceId, articleId, page),
      this.repo.countByArticle(workspaceId, articleId),
    ]);
    return { items, page: page.page, limit: page.limit, total };
  }

  async create(
    workspaceId: string,
    articleId: string,
    input: CreateCommentInput,
  ): Promise<CommentRow> {
    await this.requireArticle(workspaceId, articleId);
    return this.repo.insert({
      workspaceId,
      articleId,
      author: input.author,
      body: input.body,
    });
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const removed = await this.repo.remove(workspaceId, id);
    if (!removed) throw new NotFoundError('Comment not found');
  }

  /** 404 on an article that doesn't exist *in this workspace*. */
  private async requireArticle(workspaceId: string, articleId: string): Promise<void> {
    const article = await this.articles.getById(workspaceId, articleId);
    if (!article) throw new NotFoundError('Article not found');
  }
}
