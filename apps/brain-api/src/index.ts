import { buildServer } from './server.js';
import { createLlmFromEnv } from './llm.js';
import type { LlmProvider } from '@allyvate/shared/providers';
import type { RetrievalDeps } from '@allyvate/retrieval';
import { createDb } from '@allyvate/db';
import { createPgRetrievalDeps } from '@allyvate/retrieval/pg';

// Build the LLM provider from env. If it can't be constructed (e.g. no API key
// in local dev), start anyway with /classify disabled rather than crashing.
let llm: LlmProvider | undefined;
try {
  llm = createLlmFromEnv();
} catch (err) {
  console.warn('LLM provider not configured; /classify will return 503.', err);
}

// Wire the Postgres-backed Retrieval Intelligence Engine when a DB is available.
// No embedder yet (OpenAI adapter pending) → keyword + graph arms; vector off.
let retrieval: RetrievalDeps | undefined;
if (process.env.DATABASE_URL) {
  try {
    const { db } = createDb(process.env.DATABASE_URL);
    retrieval = createPgRetrievalDeps(db);
  } catch (err) {
    console.warn('Retrieval index not available; /retrieve will return the stub.', err);
  }
}

const app = buildServer({ llm, retrieval });
const port = Number(process.env.BRAIN_API_PORT ?? 4000);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
