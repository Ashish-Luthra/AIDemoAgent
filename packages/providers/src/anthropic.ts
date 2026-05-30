/**
 * Anthropic Claude implementation of the `LlmProvider` interface (KICKOFF
 * Architecture Lock #7). Registered into the shared LLM registry under the id
 * `anthropic`, so it's selected purely by config — swapping vendors is a config
 * change, nothing downstream of the interface moves.
 *
 * - `completeStructured` uses Zod-schema-driven **tool use**: the named schema is
 *   converted to a JSON Schema, exposed as a single forced tool, and Claude's
 *   tool-call input is returned (no free-form parsing — KICKOFF convention). If
 *   no schema is registered for the name, it falls back to JSON-mode + parse.
 * - **Prompt caching** is applied to the tools+system prefix (lock: cache stable
 *   prefixes), so repeated classification calls reuse the cached prefix.
 * - Every call is wrapped in `withResilience` (retry + circuit breaker +
 *   structured logs — lock). The SDK's own retries are disabled so retry policy
 *   lives in one place.
 * - The SDK client is **injectable** for unit tests (no network, no API key).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CircuitBreaker,
  DEFAULT_MODELS,
  noopLogger,
  withResilience,
  type Logger,
  type ResilienceOptions,
} from '@allyvate/shared';
import {
  defaultLlmRegistry,
  type LlmFactory,
  type LlmProvider,
  type LlmRegistry,
  type StreamTurnArgs,
  type StructuredCompletionArgs,
} from '@allyvate/shared/providers';

/**
 * The slice of the Anthropic SDK this provider uses. Typed narrowly so unit
 * tests can inject a fake client without standing up the whole SDK surface.
 */
export interface AnthropicMessagesClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
    stream(body: Anthropic.MessageStreamParams): AsyncIterable<Anthropic.MessageStreamEvent>;
  };
}

export interface AnthropicProviderOptions {
  /** Injectable SDK client — defaults to a real Anthropic client with retries off. */
  client?: AnthropicMessagesClient;
  apiKey?: string;
  /** Defaults to the project-locked DEFAULT_MODELS.llm (Claude Sonnet). */
  model?: string;
  /** Default per-call output cap when the caller doesn't specify. */
  maxTokens?: number;
  /**
   * Zod schemas keyed by `schemaName`. When `completeStructured` is called with a
   * registered name, the schema drives a forced tool call (guaranteed shape).
   */
  schemas?: Record<string, z.ZodType>;
  /** Cache the tools+system prefix across calls. Default true. */
  cachePrompt?: boolean;
  logger?: Logger;
  /** Shared breaker across all calls for this provider. */
  breaker?: CircuitBreaker;
  /** Retry/backoff overrides forwarded to withResilience. */
  resilience?: Partial<Omit<ResilienceOptions, 'name' | 'logger' | 'breaker'>>;
}

const DEFAULT_MAX_TOKENS = 4096;
const EPHEMERAL = { type: 'ephemeral' } as const;

/** Sanitizes a schema name into a valid Claude tool name (`^[a-zA-Z0-9_-]{1,64}$`). */
function toolNameFor(schemaName: string): string {
  const cleaned = schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'structured_output';
}

/** Transient errors worth retrying: 408/409/429/5xx, or connection/timeout/overload. */
function isTransient(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (
      typeof status === 'number' &&
      (status === 408 || status === 409 || status === 429 || status >= 500)
    ) {
      return true;
    }
    const name = (error as { name?: unknown }).name;
    if (
      typeof name === 'string' &&
      /(Connection|Timeout|Overloaded|RateLimit|InternalServer)/i.test(name)
    ) {
      return true;
    }
  }
  return false;
}

export class AnthropicLlmProvider implements LlmProvider {
  private readonly client: AnthropicMessagesClient;
  private readonly model: string;
  private readonly defaultMaxTokens: number;
  private readonly schemas: Record<string, z.ZodType>;
  private readonly cachePrompt: boolean;
  private readonly logger: Logger;
  private readonly breaker: CircuitBreaker;
  private readonly resilience: Partial<Omit<ResilienceOptions, 'name' | 'logger' | 'breaker'>>;

  constructor(options: AnthropicProviderOptions = {}) {
    // Retries off on the SDK — withResilience owns retry policy (no double-retry).
    this.client =
      options.client ??
      (new Anthropic({ apiKey: options.apiKey, maxRetries: 0 }) as AnthropicMessagesClient);
    this.model = options.model ?? DEFAULT_MODELS.llm;
    this.defaultMaxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.schemas = options.schemas ?? {};
    this.cachePrompt = options.cachePrompt ?? true;
    this.logger = (options.logger ?? noopLogger).child({ component: 'anthropic-provider' });
    this.breaker = options.breaker ?? new CircuitBreaker();
    this.resilience = options.resilience ?? {};
  }

  async completeStructured<T>(args: StructuredCompletionArgs): Promise<T> {
    const maxTokens = args.maxTokens ?? this.defaultMaxTokens;
    const schema = this.schemas[args.schemaName];

    if (schema) {
      const tool = this.buildTool(
        args.schemaName,
        schema,
        /* cache */ !args.system && this.cachePrompt,
      );
      const message = await this.send(`completeStructured:${args.schemaName}`, {
        model: this.model,
        max_tokens: maxTokens,
        system: this.buildSystem(args.system),
        messages: [{ role: 'user', content: args.prompt }],
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
      });
      const toolUse = message.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      if (!toolUse) {
        throw new Error(`Anthropic returned no tool_use block for schema "${args.schemaName}"`);
      }
      return toolUse.input as T;
    }

    // No registered schema → instruct JSON-only output and parse the text.
    const jsonSystem = [
      args.system,
      'Respond ONLY with a single valid JSON object. No prose, no code fences.',
    ]
      .filter(Boolean)
      .join('\n\n');
    const message = await this.send(`completeStructured:${args.schemaName}`, {
      model: this.model,
      max_tokens: maxTokens,
      system: this.buildSystem(jsonSystem),
      messages: [{ role: 'user', content: args.prompt }],
    });
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return JSON.parse(text) as T;
  }

  async *streamTurn(args: StreamTurnArgs): AsyncIterable<string> {
    if (!this.breaker.canRequest()) {
      this.logger.warn(
        { call: 'streamTurn', circuit: this.breaker.state },
        'circuit open — refusing stream',
      );
      throw new Error('Circuit "anthropic.streamTurn" is open');
    }
    const body: Anthropic.MessageStreamParams = {
      model: this.model,
      max_tokens: args.maxTokens ?? 16_000,
      messages: [{ role: 'user', content: args.prompt }],
    };
    const system = this.buildSystem(args.system);
    if (system) body.system = system;

    try {
      for await (const event of this.client.messages.stream(body)) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }
      this.breaker.recordSuccess();
    } catch (error) {
      this.breaker.recordFailure();
      this.logger.error({ call: 'streamTurn', err: String(error) }, 'stream failed');
      throw error;
    }
  }

  /** Wraps a non-streaming create in retry + circuit breaker + structured logs. */
  private send(
    name: string,
    body: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> {
    return withResilience(() => this.client.messages.create(body), {
      name: `anthropic.${name}`,
      logger: this.logger,
      breaker: this.breaker,
      shouldRetry: isTransient,
      ...this.resilience,
    });
  }

  /** System prompt as a (optionally cache-marked) text block array, or undefined. */
  private buildSystem(system?: string): Anthropic.TextBlockParam[] | undefined {
    if (!system) return undefined;
    const block: Anthropic.TextBlockParam = { type: 'text', text: system };
    // A breakpoint on the system block caches tools+system (render order: tools→system).
    if (this.cachePrompt) block.cache_control = EPHEMERAL;
    return [block];
  }

  /** Builds a forced-tool definition from a Zod schema (converted to JSON Schema). */
  private buildTool(schemaName: string, schema: z.ZodType, cacheOnTool: boolean): Anthropic.Tool {
    const jsonSchema = zodToJsonSchema(schema, { $refStrategy: 'none' });
    const tool: Anthropic.Tool = {
      name: toolNameFor(schemaName),
      description: `Return the result as a "${schemaName}" object matching the schema.`,
      input_schema: jsonSchema as Anthropic.Tool.InputSchema,
    };
    if (cacheOnTool) tool.cache_control = EPHEMERAL;
    return tool;
  }
}

/** Convenience constructor mirroring the other provider factories. */
export function createAnthropicProvider(options: AnthropicProviderOptions = {}): LlmProvider {
  return new AnthropicLlmProvider(options);
}

/**
 * Registry factory. Vendor-neutral `LlmProviderConfig` carries the common fields;
 * Anthropic-specific extras (`client`, `schemas`, `cachePrompt`, …) ride in
 * `config.options`.
 */
export const anthropicLlmFactory: LlmFactory = (config) => {
  const options = (config.options ?? {}) as AnthropicProviderOptions;
  return new AnthropicLlmProvider({
    ...options,
    apiKey: config.apiKey ?? options.apiKey,
    model: config.model ?? options.model,
    maxTokens: config.maxTokens ?? options.maxTokens,
  });
};

/** Registers the `anthropic` factory into a registry (defaults to the shared one). */
export function registerAnthropic(
  registry: LlmRegistry = defaultLlmRegistry,
  opts: { overwrite?: boolean } = {},
): void {
  registry.register('anthropic', anthropicLlmFactory, opts);
}
