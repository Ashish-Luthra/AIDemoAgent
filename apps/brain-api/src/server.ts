import Fastify, { type FastifyInstance } from 'fastify';
import { RetrievalQuery, type RetrievalResult } from '@allyvate/shared';

/**
 * Brain API (KICKOFF: ingestion + retrieval HTTP/WS endpoints). Week 1 ships the
 * server skeleton with a health check and a validated `/retrieve` contract; the
 * real Retrieval Intelligence Engine wires in at Week 4.
 */
export function buildServer(opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? true });

  app.get('/health', async () => ({ status: 'ok', phase: 1 }));

  app.post('/retrieve', async (request, reply) => {
    const parsed = RetrievalQuery.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }

    // Stub contract — returns the shape the RIE will fill in (Week 4).
    const result: RetrievalResult = {
      topArtifactId: null,
      confidence: 0,
      reasoningTrace: 'Retrieval Intelligence Engine not yet implemented (Week 4).',
      alternatives: [],
    };
    return result;
  });

  return app;
}
