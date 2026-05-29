/**
 * LLM provider registry — the swap point (KICKOFF Architecture Lock #7:
 * "Provider abstractions are mandatory ... swapping a vendor is a one-file
 * change").
 *
 * The `LlmProvider` interface defines the contract; this registry lets any
 * implementation be selected by config at runtime. Concrete adapters (Anthropic,
 * OpenAI, a local model, …) register a factory under an id; callers build one
 * with `create({ provider: '<id>', ... })`. To swap the LLM, change the config —
 * nothing downstream of the interface changes.
 *
 * Dependency-free on purpose: `shared` stays zod-only. SDK-backed adapters live
 * in their own package and register into a registry at startup; the built-in
 * `echo` provider here needs no SDK and powers dev/test/CI without API keys.
 */
import type { LlmProvider } from './index.js';

/** Arguments to the structured-completion path, surfaced for adapters + the echo fake. */
export interface StructuredCompletionArgs {
  system?: string;
  prompt: string;
  schemaName: string;
  maxTokens?: number;
}

/** Arguments to the streaming turn-loop path. */
export interface StreamTurnArgs {
  system?: string;
  prompt: string;
  maxTokens?: number;
}

/** Vendor-neutral config selecting and parameterizing an LLM implementation. */
export interface LlmProviderConfig {
  /** Registry id of the implementation to build (e.g. "anthropic", "openai", "echo"). */
  provider: string;
  /** Model identifier, provider-specific (e.g. "claude-sonnet-4-6"). */
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  /** Provider-specific extras a factory may read. */
  options?: Record<string, unknown>;
}

/** Builds an `LlmProvider` from a resolved config. Adapters export one of these. */
export type LlmFactory = (config: LlmProviderConfig) => LlmProvider;

/** Thrown when `create` is asked for a provider id that was never registered. */
export class UnknownLlmProviderError extends Error {
  constructor(id: string, known: string[]) {
    super(
      `Unknown LLM provider "${id}". Registered: ${known.length ? known.join(', ') : '(none)'}`,
    );
    this.name = 'UnknownLlmProviderError';
  }
}

/**
 * A registry of LLM factories keyed by provider id. Construct your own for
 * isolation, or use the shared `defaultLlmRegistry`.
 */
export class LlmRegistry {
  private readonly factories = new Map<string, LlmFactory>();

  /** Registers a factory under `id`. Refuses to clobber unless `overwrite` is set. */
  register(id: string, factory: LlmFactory, opts: { overwrite?: boolean } = {}): this {
    if (this.factories.has(id) && !opts.overwrite) {
      throw new Error(`LLM provider "${id}" is already registered`);
    }
    this.factories.set(id, factory);
    return this;
  }

  unregister(id: string): boolean {
    return this.factories.delete(id);
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  /** Registered provider ids, sorted. */
  list(): string[] {
    return [...this.factories.keys()].sort();
  }

  /** Builds the provider named by `config.provider`. Throws if unregistered. */
  create(config: LlmProviderConfig): LlmProvider {
    const factory = this.factories.get(config.provider);
    if (!factory) throw new UnknownLlmProviderError(config.provider, this.list());
    return factory(config);
  }
}

// ── Built-in echo provider (no SDK, no network) ──────────────────────────────

export interface EchoLlmOptions {
  /**
   * What `completeStructured` returns. A function receives the call args (handy
   * for asserting prompts in tests); an object/array is returned as-is. Default
   * `{}`. (Typed as `object` rather than `unknown` so the function form keeps its
   * parameter typing — structured outputs are always objects anyway.)
   */
  structured?: ((args: StructuredCompletionArgs) => unknown) | object;
  /** Optional fixed token stream for `streamTurn`; defaults to echoing the prompt. */
  stream?: (args: StreamTurnArgs) => Iterable<string>;
}

/**
 * A deterministic, dependency-free `LlmProvider` for dev/test/CI. It performs no
 * network calls: `completeStructured` returns a canned object, `streamTurn`
 * echoes the prompt token by token.
 */
export function createEchoLlmProvider(options: EchoLlmOptions = {}): LlmProvider {
  return {
    async completeStructured<T>(args: StructuredCompletionArgs): Promise<T> {
      const value =
        typeof options.structured === 'function'
          ? (options.structured as (a: StructuredCompletionArgs) => unknown)(args)
          : (options.structured ?? {});
      return value as T;
    },
    async *streamTurn(args: StreamTurnArgs): AsyncIterable<string> {
      const chunks = options.stream ? options.stream(args) : args.prompt.split(/(\s+)/);
      for (const chunk of chunks) yield chunk;
    },
  };
}

/** Builds a registry pre-loaded with the built-in `echo` provider. */
export function createDefaultLlmRegistry(): LlmRegistry {
  return new LlmRegistry().register('echo', () => createEchoLlmProvider());
}

/**
 * Process-wide registry. Adapters register their factories here at startup
 * (`defaultLlmRegistry.register('anthropic', anthropicFactory)`), and app code
 * resolves with `defaultLlmRegistry.create(config)`.
 */
export const defaultLlmRegistry: LlmRegistry = createDefaultLlmRegistry();

/**
 * Derives an `LlmProviderConfig` from environment variables. Defaults the
 * provider to "anthropic" (the locked default LLM) and accepts a generic
 * `LLM_API_KEY` or the vendor-specific `ANTHROPIC_API_KEY`.
 */
export function llmConfigFromEnv(env: Record<string, string | undefined>): LlmProviderConfig {
  const maxTokens = env.LLM_MAX_TOKENS ? Number(env.LLM_MAX_TOKENS) : undefined;
  return {
    provider: env.LLM_PROVIDER ?? 'anthropic',
    model: env.LLM_MODEL,
    apiKey: env.LLM_API_KEY ?? env.ANTHROPIC_API_KEY ?? env.OPENAI_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : undefined,
    options: {},
  };
}
