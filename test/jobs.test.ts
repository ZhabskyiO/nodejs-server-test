import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/platform/config.js';
import { MockAuthProvider, MockNotifier, MockScheduler } from '../src/adapters/mocks.js';
import { STALE_DRAFT_DIGEST } from '../src/platform/jobs.js';
import type { Db } from '../src/db/client.js';
import type { ArticleRow } from '../src/modules/articles/repository.js';
import * as t from '../src/db/schema.js';

/**
 * `NODE_ENV=test` forces jobs off (so no suite leaves a live cron behind), so
 * these tests build a non-test config with silent logs instead — which is also
 * the only way to prove the flag actually gates registration.
 */
function jobsConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'development',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://unused:unused@localhost:1/unused',
    STALE_DRAFT_CRON: '0 3 * * *',
    STALE_DRAFT_AFTER_DAYS: '14',
    ...overrides,
  });
}

/**
 * Drizzle stand-in: every builder method chains, and awaiting the chain yields
 * whatever rows were registered for the table passed to `.from()`. Enough for
 * the job's two reads, and keeps this suite in the DB-free lane — the real SQL
 * is covered by `articles-digest.it.test.ts`.
 */
function fakeDb(rowsByTable: Array<[unknown, unknown[]]>): Db {
  const chain = (rows: unknown[]) => {
    const link: Record<string, unknown> = {
      then: (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(onFulfilled, onRejected),
    };
    for (const method of ['where', 'orderBy', 'limit', 'offset']) link[method] = () => link;
    return link;
  };
  return {
    select: () => ({
      from: (table: unknown) => chain(rowsByTable.find(([key]) => key === table)?.[1] ?? []),
    }),
  } as unknown as Db;
}

const draft = (slug: string, workspaceId: string, updatedAt: string): ArticleRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId,
  authorId: '33333333-3333-4333-8333-333333333333',
  slug,
  title: slug,
  body: 'body',
  status: 'draft',
  tags: [],
  publishedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date(updatedAt),
});

describe('background jobs', () => {
  it('registers the stale-draft digest under the configured expression', async () => {
    const scheduler = new MockScheduler();
    const app = await buildApp({
      config: jobsConfig({ STALE_DRAFT_CRON: '30 4 * * 1' }),
      db: fakeDb([]),
      overrides: { scheduler, auth: new MockAuthProvider() },
    });

    expect(scheduler.jobs).toHaveLength(1);
    expect(scheduler.jobs[0]).toMatchObject({
      name: STALE_DRAFT_DIGEST,
      expression: '30 4 * * 1',
    });

    await app.close();
    expect(scheduler.stopped).toBe(true);
  });

  it('registers nothing when JOBS_ENABLED is false', async () => {
    const scheduler = new MockScheduler();
    const app = await buildApp({
      config: jobsConfig({ JOBS_ENABLED: 'false' }),
      db: fakeDb([]),
      overrides: { scheduler, auth: new MockAuthProvider() },
    });

    expect(scheduler.jobs).toEqual([]);
    await app.close();
  });

  it('never registers a job under NODE_ENV=test, whatever the flag says', () => {
    const config = loadConfig({ NODE_ENV: 'test', JOBS_ENABLED: 'true' });
    expect(config.jobs.enabled).toBe(false);
  });

  it('notifies once per workspace that has stale drafts', async () => {
    const scheduler = new MockScheduler();
    const notifier = new MockNotifier();
    const app = await buildApp({
      config: jobsConfig(),
      db: fakeDb([
        [
          t.workspaces,
          [{ id: '22222222-2222-4222-8222-222222222222' }, { id: 'aaaaaaaa-0000-0000-0000-0000' }],
        ],
        [t.articles, [draft('hello', 'ws-1', '2026-01-02T00:00:00.000Z')]],
      ]),
      overrides: { scheduler, notifier, auth: new MockAuthProvider() },
    });

    await scheduler.trigger(STALE_DRAFT_DIGEST);

    // Both workspaces are swept, and each digest carries a rendered line.
    expect(notifier.staleDrafts).toHaveLength(2);
    expect(notifier.staleDrafts[0]!.workspaceId).toBe('22222222-2222-4222-8222-222222222222');
    expect(notifier.staleDrafts[0]!.lines[0]).toMatch(/^hello — untouched since 2026-01-02 \(\d+d\)/);

    await app.close();
  });

  it('sends nothing when no draft is stale', async () => {
    const scheduler = new MockScheduler();
    const notifier = new MockNotifier();
    const app = await buildApp({
      config: jobsConfig(),
      db: fakeDb([[t.workspaces, [{ id: '22222222-2222-4222-8222-222222222222' }]]]),
      overrides: { scheduler, notifier, auth: new MockAuthProvider() },
    });

    await scheduler.trigger(STALE_DRAFT_DIGEST);

    expect(notifier.staleDrafts).toEqual([]);
    await app.close();
  });

  it('keeps sweeping after one workspace fails', async () => {
    const scheduler = new MockScheduler();
    const notifier = new MockNotifier();
    let call = 0;
    const db = fakeDb([
      [t.workspaces, [{ id: 'ws-1' }, { id: 'ws-2' }]],
      [t.articles, [draft('hello', 'ws-2', '2026-01-02T00:00:00.000Z')]],
    ]);
    const flaky = {
      select: (...args: unknown[]) => {
        const builder = (db as unknown as { select: (...a: unknown[]) => { from: unknown } }).select(
          ...args,
        );
        return {
          from: (table: unknown) => {
            // Fail the first articles read only — the workspace list is read first.
            if (table === t.articles && call++ === 0) throw new Error('connection reset');
            return (builder as { from: (t: unknown) => unknown }).from(table);
          },
        };
      },
    } as unknown as Db;

    const app = await buildApp({
      config: jobsConfig(),
      db: flaky,
      overrides: { scheduler, notifier, auth: new MockAuthProvider() },
    });

    await expect(scheduler.trigger(STALE_DRAFT_DIGEST)).resolves.toBeUndefined();
    expect(notifier.staleDrafts).toHaveLength(1);

    await app.close();
  });
});
