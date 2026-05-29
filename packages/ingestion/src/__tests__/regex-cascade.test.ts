import { describe, expect, it } from 'vitest';
import { inferEdgesFromText } from '../regex-cascade.js';

describe('regex edge cascade (zero LLM)', () => {
  it('types an INTEGRATES_WITH edge', () => {
    const edges = inferEdgesFromText('Match Booster integrates with Salesforce out of the box.');
    expect(edges).toContainEqual({
      type: 'INTEGRATES_WITH',
      target: 'Salesforce',
      method: 'regex',
    });
  });

  it('types a USES edge', () => {
    const edges = inferEdgesFromText('The pipeline is powered by Postgres and pgvector.');
    expect(edges.some((e) => e.type === 'USES' && e.target.startsWith('Postgres'))).toBe(true);
  });

  it('returns nothing for text with no structural cues', () => {
    expect(inferEdgesFromText('Hello there.')).toEqual([]);
  });
});
