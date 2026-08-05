import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/app.js';

/**
 * DB-free route checks: health, validation at the edge, error envelope shape.
 * Anything that needs real rows lives in `*.it.test.ts`.
 */
describe('routes smoke', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health is ok without touching the db', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready reports 503 when the db is unreachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ready: false });
  });

  it('rejects an empty article body with 422 before reaching the db', async () => {
    const res = await app.inject({ method: 'POST', url: '/articles', payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('rejects an over-long title', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/articles',
      payload: { title: 'x'.repeat(201), body: 'ok' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects an unknown status value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/articles',
      payload: { title: 'ok', body: 'ok', status: 'archived' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects a non-uuid :id param', async () => {
    const res = await app.inject({ method: 'GET', url: '/articles/not-a-uuid' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('rejects an empty PATCH body', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/articles/11111111-1111-4111-8111-111111111111',
      payload: {},
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects a limit above the cap', async () => {
    const res = await app.inject({ method: 'GET', url: '/articles?limit=1000' });
    expect(res.statusCode).toBe(422);
  });

  it('never leaks a driver error message on an unexpected failure', async () => {
    const res = await app.inject({ method: 'GET', url: '/articles' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'internal_error', message: 'Internal error' },
    });
    expect(res.body).not.toContain('hunter2');
  });

  it('sets security headers from helmet', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
