import { describe, expect, it } from 'vitest';
import { SCORING_WEIGHTS } from '../constants.js';
import { KO_SUBTYPES, ClassifierOutput } from '../knowledge-object.js';
import { EDGE_TYPES } from '../graph.js';

describe('scoring weights', () => {
  it('sum to exactly 1.0 (the seven-input contract)', () => {
    const total = Object.values(SCORING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it('has exactly seven inputs', () => {
    expect(Object.keys(SCORING_WEIGHTS)).toHaveLength(7);
  });
});

describe('vocabulary', () => {
  it('defines all eight Knowledge Object subtypes', () => {
    expect(KO_SUBTYPES).toHaveLength(8);
  });

  it('defines the regex-typed edge trio plus semantic edges', () => {
    expect(EDGE_TYPES).toContain('USES');
    expect(EDGE_TYPES).toContain('INTEGRATES_WITH');
    expect(EDGE_TYPES).toContain('FOR_PERSONA');
  });
});

describe('ClassifierOutput schema', () => {
  it('rejects an out-of-range confidence', () => {
    const result = ClassifierOutput.safeParse({
      subtype: 'CaseStudy',
      title: 'X',
      summary: 's',
      personaTags: [],
      objectionTags: [],
      inferredEdges: [],
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });
});
