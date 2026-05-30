/**
 * LLM wiring for the Brain API. Registers the Anthropic provider into the shared
 * registry and resolves whichever implementation the environment selects (the
 * swap point — KICKOFF Architecture Lock #7). The `ClassifierOutput` Zod schema
 * is supplied so the ingestion classifier's structured calls drive a forced tool
 * call rather than free-form parsing.
 *
 * Set `LLM_PROVIDER` + the matching API key (e.g. `ANTHROPIC_API_KEY`) to pick a
 * vendor; defaults to `anthropic`. Use `LLM_PROVIDER=echo` for keyless dev.
 */
import { ClassifierOutput } from '@allyvate/shared';
import { defaultLlmRegistry, llmConfigFromEnv, type LlmProvider } from '@allyvate/shared/providers';
import { registerAnthropic } from '@allyvate/providers';

/** Zod schemas the classifier path needs registered for structured tool use. */
const SCHEMAS = { ClassifierOutput };

/**
 * Builds the configured LLM provider from environment variables. Idempotently
 * registers the Anthropic factory, then resolves the env-selected provider with
 * the classifier schema attached. Throws if the selected vendor's client can't
 * be constructed (e.g. a missing API key) — callers decide whether to degrade.
 */
export function createLlmFromEnv(
  env: Record<string, string | undefined> = process.env,
): LlmProvider {
  registerAnthropic(defaultLlmRegistry, { overwrite: true });
  const config = llmConfigFromEnv(env);
  return defaultLlmRegistry.create({ ...config, options: { schemas: SCHEMAS } });
}
