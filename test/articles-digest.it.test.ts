import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockNotifier, MockScheduler } from '../src/adapters/mocks.js';
import { STALE_DRAFT_DIGEST } from '../src/platform/jobs.js';
import { DEFAULT_WORKSPACE_ID, SYSTEM_USER_ID } from '../src/adapters/auth/local.js';
import { dockerAvailable, startPg, truncateDomain, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();

const OTHER_WORKSPACE_ID = '99999999-9999-4999-8999-999999999999';
const OTHER_USER_ID = '88888888-8888-4888-8888-888888888888';

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

describe.skipIf(!hasDocker)('stale draft digest job (db)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let scheduler: MockScheduler;
  let notifier: MockNotifier;

  beforeAll(async () => {
    pg = await startPg();

    // A second tenant, so the sweep has something it must not mix up.
    await pg.handle.db
      .insert(t.workspaces)
      .values({ id: OTHER_WORKSPACE_ID, name: 'Other workspace' })
      .onConflictDoNothing();
    await pg.handle.db
      .insert(t.users)
      .values({
        id: OTHER_USER_ID,
        workspaceId: OTHER_WORKSPACE_ID,
        email: 'other@example.com',
        displayName: 'Other',
      })
      .onConflictDoNothing();

    scheduler = new MockScheduler();
    notifier = new MockNotifier();
    // `testConfig()` would force jobs off (NODE_ENV=test), so build a silent
    // development config instead — the job has to be registered to be run.
    app = await buildApp({
      config: loadConfig({
        NODE_ENV: 'development',
        LOG_LEVEL: 'silent',
        DATABASE_URL: pg.url,
        STALE_DRAFT_AFTER_DAYS: '14',
      }),
      db: pg.handle.db,
      overrides: { scheduler, notifier },
    });
  });

  afterEach(async () => {
    await truncateDomain(pg);
    notifier.staleDrafts.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await pg.stop();
  });

  const seedArticle = async (values: {
    slug: string;
    status: string;
    updatedAt: Date;
    workspaceId?: string;
  }) => {
    const workspaceId = values.workspaceId ?? DEFAULT_WORKSPACE_ID;
    await pg.handle.db.insert(t.articles).values({
      workspaceId,
      authorId: workspaceId === DEFAULT_WORKSPACE_ID ? SYSTEM_USER_ID : OTHER_USER_ID,
      slug: values.slug,
      title: values.slug,
      body: 'body',
      status: values.status,
      updatedAt: values.updatedAt,
    });
  };

  it('reports only drafts that went stale, oldest first', async () => {
    await seedArticle({ slug: 'ancient', status: 'draft', updatedAt: daysAgo(60) });
    await seedArticle({ slug: 'stale', status: 'draft', updatedAt: daysAgo(20) });
    await seedArticle({ slug: 'fresh', status: 'draft', updatedAt: daysAgo(2) });

    await scheduler.trigger(STALE_DRAFT_DIGEST);

    expect(notifier.staleDrafts).toHaveLength(1);
    const { workspaceId, lines } = notifier.staleDrafts[0]!;
    expect(workspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('ancient');
    expect(lines[1]).toContain('stale');
  });

  it('ignores published articles however old they are', async () => {
    await seedArticle({ slug: 'long-published', status: 'published', updatedAt: daysAgo(400) });

    await scheduler.trigger(STALE_DRAFT_DIGEST);

    expect(notifier.staleDrafts).toEqual([]);
  });

  it('never leaks another workspace’s draft into a digest', async () => {
    await seedArticle({ slug: 'ours', status: 'draft', updatedAt: daysAgo(30) });
    await seedArticle({
      slug: 'theirs',
      status: 'draft',
      updatedAt: daysAgo(30),
      workspaceId: OTHER_WORKSPACE_ID,
    });

    await scheduler.trigger(STALE_DRAFT_DIGEST);

    // One digest per workspace, each holding only its own row.
    expect(notifier.staleDrafts).toHaveLength(2);
    const byWorkspace = new Map(notifier.staleDrafts.map((e) => [e.workspaceId, e.lines]));
    expect(byWorkspace.get(DEFAULT_WORKSPACE_ID)).toEqual([
      expect.stringContaining('ours') as unknown as string,
    ]);
    expect(byWorkspace.get(OTHER_WORKSPACE_ID)).toEqual([
      expect.stringContaining('theirs') as unknown as string,
    ]);
  });

  it('leaves the reported drafts alone — the digest is read-only', async () => {
    const updatedAt = daysAgo(30);
    await seedArticle({ slug: 'untouched', status: 'draft', updatedAt });

    await scheduler.trigger(STALE_DRAFT_DIGEST);

    const [row] = await pg.handle.db.select().from(t.articles);
    expect(row!.status).toBe('draft');
    expect(row!.updatedAt.getTime()).toBe(updatedAt.getTime());
  });

  it('caps one workspace’s digest at the configured limit', async () => {
    const capped = await buildApp({
      config: loadConfig({
        NODE_ENV: 'development',
        LOG_LEVEL: 'silent',
        DATABASE_URL: pg.url,
        STALE_DRAFT_AFTER_DAYS: '14',
        STALE_DRAFT_LIMIT: '2',
      }),
      db: pg.handle.db,
      overrides: { scheduler: new MockScheduler(), notifier },
    });
    const cappedScheduler = capped.container.scheduler as MockScheduler;

    for (const n of [1, 2, 3, 4]) {
      await seedArticle({ slug: `old-${n}`, status: 'draft', updatedAt: daysAgo(20 + n) });
    }

    await cappedScheduler.trigger(STALE_DRAFT_DIGEST);

    expect(notifier.staleDrafts[0]!.lines).toHaveLength(2);
    await capped.close();
  });
});
