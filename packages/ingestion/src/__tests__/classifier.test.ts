import { describe, expect, it, vi } from 'vitest';
import type { LlmProvider } from '@allyvate/shared/providers';
import { ClassificationError, classifyDocument } from '../classifier.js';

const VALID_OUTPUT = {
  subtype: 'ObjectionHandler',
  title: 'Handling the "too expensive" objection',
  summary: 'Reframes price around ROI.',
  personaTags: ['CFO'],
  objectionTags: ['price'],
  inferredEdges: [{ type: 'COUNTERED_BY', targetCanonicalName: 'ROI Calculator', confidence: 0.6 }],
  confidence: 0.82,
};

/** Builds a fake LlmProvider whose completeStructured returns queued values in order. */
function fakeLlm(...returns: unknown[]): LlmProvider {
  const completeStructured = vi.fn();
  for (const value of returns) completeStructured.mockResolvedValueOnce(value);
  return {
    completeStructured,
    // eslint-disable-next-line require-yield
    streamTurn: async function* () {
      throw new Error('not used');
    },
  } as unknown as LlmProvider;
}

describe('classifyDocument', () => {
  it('returns the validated output on a valid first response', async () => {
    const llm = fakeLlm(VALID_OUTPUT);
    const result = await classifyDocument({ text: 'Some objection content', llm });
    expect(result.subtype).toBe('ObjectionHandler');
    expect(result.confidence).toBeCloseTo(0.82);
    expect(llm.completeStructured).toHaveBeenCalledTimes(1);
  });

  it('passes brand-book context and source into the prompt', async () => {
    const llm = fakeLlm(VALID_OUTPUT);
    await classifyDocument({
      text: 'content',
      llm,
      source: 'gdrive',
      brandBookContext: '# Brand Book\n## Voice\nConcise.',
      title: 'Deck',
    });
    const call = (llm.completeStructured as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.prompt).toContain('Brand Book');
    expect(call.prompt).toContain('Source system: gdrive');
    expect(call.prompt).toContain('Deck');
    expect(call.schemaName).toBe('ClassifierOutput');
  });

  it('retries once on a schema-invalid response, feeding back the issues', async () => {
    const invalid = { ...VALID_OUTPUT, subtype: 'NotARealSubtype' };
    const llm = fakeLlm(invalid, VALID_OUTPUT);
    const result = await classifyDocument({ text: 'content', llm, maxAttempts: 2 });
    expect(result.subtype).toBe('ObjectionHandler');
    expect(llm.completeStructured).toHaveBeenCalledTimes(2);
    const retryPrompt = (llm.completeStructured as ReturnType<typeof vi.fn>).mock.calls[1]![0]
      .prompt;
    expect(retryPrompt).toContain('failed schema validation');
    expect(retryPrompt).toContain('subtype');
  });

  it('throws ClassificationError after exhausting attempts', async () => {
    const invalid = { nope: true };
    const llm = fakeLlm(invalid, invalid);
    await expect(classifyDocument({ text: 'content', llm, maxAttempts: 2 })).rejects.toBeInstanceOf(
      ClassificationError,
    );
    expect(llm.completeStructured).toHaveBeenCalledTimes(2);
  });
});
