import { buildServer } from './server.js';
import { createLlmFromEnv } from './llm.js';
import type { LlmProvider } from '@allyvate/shared/providers';

// Build the LLM provider from env. If it can't be constructed (e.g. no API key
// in local dev), start anyway with /classify disabled rather than crashing.
let llm: LlmProvider | undefined;
try {
  llm = createLlmFromEnv();
} catch (err) {
  console.warn('LLM provider not configured; /classify will return 503.', err);
}

const app = buildServer({ llm });
const port = Number(process.env.BRAIN_API_PORT ?? 4000);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
