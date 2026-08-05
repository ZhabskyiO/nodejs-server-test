export const ARTICLE_STATUSES = ['draft', 'published'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const MAX_TITLE_LENGTH = 200;
export const MAX_BODY_LENGTH = 50_000;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 32;

/** Suffix budget for slug de-duplication: `title-2`, `title-3`, … */
export const MAX_SLUG_ATTEMPTS = 50;
