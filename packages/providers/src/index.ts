/**
 * SDK-backed provider implementations (KICKOFF Architecture Lock #7). Concrete
 * adapters live here so vendor SDKs stay out of `@allyvate/shared`; each registers
 * into the shared LLM registry by id, keeping the swap a config change.
 */
export * from './anthropic.js';

export const PACKAGE = '@allyvate/providers';
