import { describe, expect, it } from 'vitest';
import type { LlmProvider } from '../providers/index.js';
import {
  LlmRegistry,
  UnknownLlmProviderError,
  createDefaultLlmRegistry,
  createEchoLlmProvider,
  llmConfigFromEnv,
} from '../providers/index.js';

/** A trivial provider that tags its output with a label so we can tell impls apart. */
function labelled(label: string): LlmProvider {
  return {
    async completeStructured<T>(): Promise<T> {
      return { from: label } as T;
    },
    // eslint-disable-next-line require-yield
    async *streamTurn(): AsyncIterable<string> {
      throw new Error('unused');
    },
  };
}

describe('LlmRegistry', () => {
  it('registers a factory and builds it via create()', () => {
    const reg = new LlmRegistry().register('alpha', () => labelled('alpha'));
    const provider = reg.create({ provider: 'alpha' });
    expect(provider).toBeDefined();
    expect(reg.has('alpha')).toBe(true);
  });

  it('throws UnknownLlmProviderError for an unregistered id', () => {
    const reg = new LlmRegistry();
    expect(() => reg.create({ provider: 'nope' })).toThrow(UnknownLlmProviderError);
  });

  it('refuses to clobber an existing id unless overwrite is set', () => {
    const reg = new LlmRegistry().register('a', () => labelled('a'));
    expect(() => reg.register('a', () => labelled('a2'))).toThrow(/already registered/);
    expect(() => reg.register('a', () => labelled('a2'), { overwrite: true })).not.toThrow();
  });

  it('lists registered ids sorted', () => {
    const reg = new LlmRegistry()
      .register('zeta', () => labelled('z'))
      .register('alpha', () => labelled('a'));
    expect(reg.list()).toEqual(['alpha', 'zeta']);
  });

  it('swaps the active LLM purely by config — nothing else changes', async () => {
    const reg = new LlmRegistry()
      .register('vendor-a', () => labelled('vendor-a'))
      .register('vendor-b', () => labelled('vendor-b'));

    const callWith = async (provider: string) => {
      const llm = reg.create({ provider });
      return llm.completeStructured<{ from: string }>({ prompt: 'hi', schemaName: 'X' });
    };

    expect(await callWith('vendor-a')).toEqual({ from: 'vendor-a' });
    expect(await callWith('vendor-b')).toEqual({ from: 'vendor-b' });
  });
});

describe('createEchoLlmProvider', () => {
  it('returns the canned structured object (default empty)', async () => {
    const echo = createEchoLlmProvider();
    expect(await echo.completeStructured({ prompt: 'p', schemaName: 'X' })).toEqual({});
  });

  it('returns a fixed object or a function of the call args', async () => {
    const fixed = createEchoLlmProvider({ structured: { ok: true } });
    expect(await fixed.completeStructured({ prompt: 'p', schemaName: 'X' })).toEqual({ ok: true });

    const dynamic = createEchoLlmProvider({ structured: (a) => ({ saw: a.schemaName }) });
    expect(await dynamic.completeStructured({ prompt: 'p', schemaName: 'KO' })).toEqual({
      saw: 'KO',
    });
  });

  it('echoes the prompt token by token on streamTurn', async () => {
    const echo = createEchoLlmProvider();
    const out: string[] = [];
    for await (const chunk of echo.streamTurn({ prompt: 'hello world' })) out.push(chunk);
    expect(out.join('')).toBe('hello world');
  });
});

describe('createDefaultLlmRegistry', () => {
  it('ships with the built-in echo provider registered', () => {
    const reg = createDefaultLlmRegistry();
    expect(reg.has('echo')).toBe(true);
    expect(reg.create({ provider: 'echo' })).toBeDefined();
  });
});

describe('llmConfigFromEnv', () => {
  it('defaults the provider to anthropic and reads model + keys', () => {
    const cfg = llmConfigFromEnv({ LLM_MODEL: 'claude-sonnet-4-6', ANTHROPIC_API_KEY: 'sk-x' });
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.model).toBe('claude-sonnet-4-6');
    expect(cfg.apiKey).toBe('sk-x');
  });

  it('honors an explicit LLM_PROVIDER and generic LLM_API_KEY', () => {
    const cfg = llmConfigFromEnv({
      LLM_PROVIDER: 'openai',
      LLM_API_KEY: 'sk-o',
      LLM_MAX_TOKENS: '512',
    });
    expect(cfg.provider).toBe('openai');
    expect(cfg.apiKey).toBe('sk-o');
    expect(cfg.maxTokens).toBe(512);
  });
});
