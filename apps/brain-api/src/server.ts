import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RetrievalQuery, type RetrievalResult } from '@allyvate/shared';
import type { LlmProvider } from '@allyvate/shared/providers';
import { ClassificationError, classifyDocument } from '@allyvate/ingestion';
import { runRetrieval, type RetrievalDeps } from '@allyvate/retrieval';

/**
 * Brain API (KICKOFF: ingestion + retrieval HTTP/WS endpoints). Ships a health
 * check, `/retrieve` (the Retrieval Intelligence Engine when retrieval deps are
 * wired; otherwise the contract stub), and `/classify` (the ingestion classifier
 * against the configured LLM provider).
 */

/** Request body for `/classify`. */
const ClassifyRequest = z.object({
  text: z.string().min(1),
  source: z.string().optional(),
  title: z.string().optional(),
});

export interface BuildServerOptions {
  logger?: boolean;
  /** LLM provider backing `/classify`. When absent, `/classify` returns 503. */
  llm?: LlmProvider;
  /** Retrieval Intelligence Engine deps backing `/retrieve`. Absent → contract stub. */
  retrieval?: RetrievalDeps;
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? true });

  app.get('/health', async () => ({ status: 'ok', phase: 1, llm: Boolean(opts.llm) }));

  app.post('/retrieve', async (request, reply) => {
    const parsed = RetrievalQuery.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    if (opts.retrieval) {
      return runRetrieval(parsed.data, opts.retrieval);
    }

    // No retrieval index wired (e.g. no DATABASE_URL) — return the contract stub.
    const result: RetrievalResult = {
      topArtifactId: null,
      confidence: 0,
      reasoningTrace: 'Retrieval index not configured (set DATABASE_URL).',
      alternatives: [],
    };
    return result;
  });

  app.post('/classify', async (request, reply) => {
    if (!opts.llm) {
      reply.code(503);
      return { error: 'LLM provider not configured (set LLM_PROVIDER + API key)' };
    }
    const parsed = ClassifyRequest.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }
    try {
      return await classifyDocument({
        text: parsed.data.text,
        source: parsed.data.source,
        title: parsed.data.title,
        llm: opts.llm,
      });
    } catch (err) {
      // A classifier that can't produce a schema-valid result is a 422, not a 500.
      const code = err instanceof ClassificationError ? 422 : 502;
      request.log.error({ err }, 'classification failed');
      reply.code(code);
      return { error: 'classification failed' };
    }
  });

  return app;
}
