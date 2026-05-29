import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = buildServer({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('brain-api', () => {
  it('reports healthy', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('rejects a malformed /retrieve body with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/retrieve', payload: { question: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns the retrieval contract shape for a valid query', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/retrieve',
      payload: {
        tenantId: '00000000-0000-0000-0000-000000000000',
        question: 'What is Match Booster?',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('reasoningTrace');
    expect(res.json()).toHaveProperty('alternatives');
  });
});
