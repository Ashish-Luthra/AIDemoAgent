import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LlmProvider } from '@allyvate/shared/providers';
import type { RetrievalDeps } from '@allyvate/retrieval';
import { buildServer } from '../server.js';

let app: FastifyInstance;
let appWithLlm: FastifyInstance;
let appWithRetrieval: FastifyInstance;

const ARTIFACT_ID = '11111111-1111-1111-1111-111111111111';

/** In-memory retrieval deps so /retrieve can be tested without a database. */
const fakeRetrieval: RetrievalDeps = {
  arms: [{ name: 'vector', search: async () => ({ ids: [ARTIFACT_ID] }) }],
  features: {
    features: async (_t, ids) =>
      new Map(
        ids
          .filter((id) => id === ARTIFACT_ID)
          .map((id) => [
            id,
            {
              artifactId: id,
              subtype: 'CaseStudy' as const,
              title: 'Match Booster case study',
              personaTags: [],
              objectionTags: [],
              historicalSuccess: 1,
              opportunityStageFit: 0.5,
              freshness: 1,
              approval: 1,
            },
          ]),
      ),
  },
};

/** A fake provider returning a valid ClassifierOutput so /classify can be tested offline. */
const fakeLlm: LlmProvider = {
  async completeStructured<T>(): Promise<T> {
    return {
      subtype: 'CaseStudy',
      title: 'Acme cuts onboarding 40%',
      summary: 'A case study.',
      personaTags: ['CRO'],
      objectionTags: [],
      inferredEdges: [],
      confidence: 0.77,
    } as T;
  },
  // eslint-disable-next-line require-yield
  async *streamTurn(): AsyncIterable<string> {
    throw new Error('unused');
  },
};

beforeAll(async () => {
  app = buildServer({ logger: false });
  appWithLlm = buildServer({ logger: false, llm: fakeLlm });
  appWithRetrieval = buildServer({ logger: false, retrieval: fakeRetrieval });
  await Promise.all([app.ready(), appWithLlm.ready(), appWithRetrieval.ready()]);
});

afterAll(async () => {
  await Promise.all([app.close(), appWithLlm.close(), appWithRetrieval.close()]);
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

  it('returns the retrieval contract shape (stub) when no index is wired', async () => {
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

  it('runs the RIE through /retrieve when retrieval deps are wired', async () => {
    const res = await appWithRetrieval.inject({
      method: 'POST',
      url: '/retrieve',
      payload: {
        tenantId: '00000000-0000-0000-0000-000000000000',
        question: 'What is Match Booster?',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ topArtifactId: ARTIFACT_ID });
    expect(res.json().confidence).toBeGreaterThan(0);
  });

  it('returns 503 from /classify when no LLM is configured', async () => {
    const res = await app.inject({ method: 'POST', url: '/classify', payload: { text: 'hello' } });
    expect(res.statusCode).toBe(503);
  });

  it('rejects a malformed /classify body with 400', async () => {
    const res = await appWithLlm.inject({
      method: 'POST',
      url: '/classify',
      payload: { text: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('classifies a document against the configured provider', async () => {
    const res = await appWithLlm.inject({
      method: 'POST',
      url: '/classify',
      payload: {
        text: 'Acme reduced onboarding time by 40% using our platform.',
        source: 'gdrive',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ subtype: 'CaseStudy', confidence: 0.77 });
  });
});
