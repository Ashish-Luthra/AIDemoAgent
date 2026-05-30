import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LlmRegistry } from '@allyvate/shared/providers';
import {
  AnthropicLlmProvider,
  registerAnthropic,
  type AnthropicMessagesClient,
} from '../anthropic.js';

const SCHEMA = z.object({ subtype: z.string(), confidence: z.number() });

function toolMessage(input: unknown): Anthropic.Message {
  return {
    content: [{ type: 'tool_use', id: 't1', name: 'x', input }],
  } as unknown as Anthropic.Message;
}

function textMessage(text: string): Anthropic.Message {
  return { content: [{ type: 'text', text }] } as unknown as Anthropic.Message;
}

function clientWith(create: unknown, stream?: unknown): AnthropicMessagesClient {
  return {
    messages: {
      create,
      stream:
        stream ??
        (() => {
          throw new Error('stream not configured');
        }),
    },
  } as unknown as AnthropicMessagesClient;
}

/** Pulls the body passed to the Nth create() call for assertions. */
function bodyOf(
  create: ReturnType<typeof vi.fn>,
  n = 0,
): Anthropic.MessageCreateParamsNonStreaming {
  return create.mock.calls[n]![0] as Anthropic.MessageCreateParamsNonStreaming;
}

describe('AnthropicLlmProvider.completeStructured', () => {
  it('drives a forced tool call from the registered Zod schema and returns its input', async () => {
    const result = { subtype: 'ObjectionHandler', confidence: 0.9 };
    const create = vi.fn().mockResolvedValue(toolMessage(result));
    const provider = new AnthropicLlmProvider({
      client: clientWith(create),
      schemas: { ClassifierOutput: SCHEMA },
    });

    const out = await provider.completeStructured({
      prompt: 'classify me',
      schemaName: 'ClassifierOutput',
    });
    expect(out).toEqual(result);

    const body = bodyOf(create);
    expect(body.tools).toHaveLength(1);
    const tool = body.tools![0] as Anthropic.Tool;
    expect(tool.name).toBe('ClassifierOutput');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'ClassifierOutput' });
    // Schema converted to an object JSON Schema for the tool input.
    expect((tool.input_schema as { type?: string }).type).toBe('object');
  });

  it('marks the tool for prompt caching when there is no system prefix', async () => {
    const create = vi.fn().mockResolvedValue(toolMessage({ subtype: 'X', confidence: 1 }));
    const provider = new AnthropicLlmProvider({
      client: clientWith(create),
      schemas: { Thing: SCHEMA },
    });
    await provider.completeStructured({ prompt: 'p', schemaName: 'Thing' });
    expect((bodyOf(create).tools![0] as { cache_control?: unknown }).cache_control).toEqual({
      type: 'ephemeral',
    });
  });

  it('marks the system block for caching when a system prompt is provided', async () => {
    const create = vi.fn().mockResolvedValue(toolMessage({ subtype: 'X', confidence: 1 }));
    const provider = new AnthropicLlmProvider({
      client: clientWith(create),
      schemas: { Thing: SCHEMA },
    });
    await provider.completeStructured({
      prompt: 'p',
      schemaName: 'Thing',
      system: 'You are a classifier.',
    });
    const system = bodyOf(create).system as Anthropic.TextBlockParam[];
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('falls back to JSON-mode parsing when no schema is registered for the name', async () => {
    const create = vi.fn().mockResolvedValue(textMessage('{"answer": 42}'));
    const provider = new AnthropicLlmProvider({ client: clientWith(create) });
    const out = await provider.completeStructured<{ answer: number }>({
      prompt: 'p',
      schemaName: 'Unknown',
    });
    expect(out).toEqual({ answer: 42 });
    expect(bodyOf(create).tools).toBeUndefined();
    expect((bodyOf(create).system as Anthropic.TextBlockParam[])[0]!.text).toContain('valid JSON');
  });

  it('retries transient failures via withResilience', async () => {
    const transient = Object.assign(new Error('overloaded'), { status: 529 });
    const create = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValue(toolMessage({ subtype: 'X', confidence: 1 }));
    const provider = new AnthropicLlmProvider({
      client: clientWith(create),
      schemas: { Thing: SCHEMA },
      resilience: { sleep: () => Promise.resolve() },
    });
    await provider.completeStructured({ prompt: 'p', schemaName: 'Thing' });
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('AnthropicLlmProvider.streamTurn', () => {
  it('yields text deltas and skips non-text events', async () => {
    async function* fakeStream(): AsyncIterable<Anthropic.MessageStreamEvent> {
      yield { type: 'message_start' } as unknown as Anthropic.MessageStreamEvent;
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello ' },
      } as unknown as Anthropic.MessageStreamEvent;
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'world' },
      } as unknown as Anthropic.MessageStreamEvent;
    }
    const provider = new AnthropicLlmProvider({
      client: clientWith(vi.fn(), () => fakeStream()),
    });

    const chunks: string[] = [];
    for await (const c of provider.streamTurn({ prompt: 'hi' })) chunks.push(c);
    expect(chunks.join('')).toBe('Hello world');
  });
});

describe('registerAnthropic', () => {
  it('registers an "anthropic" factory that builds a working provider from config', async () => {
    const registry = new LlmRegistry();
    registerAnthropic(registry);
    expect(registry.has('anthropic')).toBe(true);

    const create = vi.fn().mockResolvedValue(toolMessage({ subtype: 'X', confidence: 0.5 }));
    const provider = registry.create({
      provider: 'anthropic',
      options: { client: clientWith(create), schemas: { Thing: SCHEMA } },
    });
    const out = await provider.completeStructured({ prompt: 'p', schemaName: 'Thing' });
    expect(out).toEqual({ subtype: 'X', confidence: 0.5 });
  });
});
