import { describe, expect, it } from 'vitest';
import { SCORING_WEIGHTS } from '@allyvate/shared';
import { scoreCandidate, topContributions, type ScoreInputs } from '../scoring.js';

const ALL = (v: number): ScoreInputs => ({
  relevance: v,
  persona: v,
  objection: v,
  historicalSuccess: v,
  opportunityStage: v,
  freshness: v,
  approval: v,
});

describe('scoreCandidate', () => {
  it('scores all-ones inputs to 1.0 (weights sum to 1)', () => {
    const { score } = scoreCandidate(ALL(1));
    expect(score).toBeCloseTo(1);
  });

  it('scores all-zero inputs to 0', () => {
    expect(scoreCandidate(ALL(0)).score).toBe(0);
  });

  it('breakdown holds each input weighted contribution', () => {
    const { breakdown } = scoreCandidate(ALL(1));
    expect(breakdown.relevance).toBeCloseTo(SCORING_WEIGHTS.relevance);
    expect(breakdown.approval).toBeCloseTo(SCORING_WEIGHTS.approval);
  });

  it('clamps out-of-range inputs into [0,1]', () => {
    const { breakdown } = scoreCandidate({ ...ALL(0), relevance: 5, persona: -3 });
    expect(breakdown.relevance).toBeCloseTo(SCORING_WEIGHTS.relevance); // 5 → 1
    expect(breakdown.persona).toBe(0); // -3 → 0
  });

  it('relevance dominates by weight (0.30) over freshness (0.05)', () => {
    const relevanceOnly = scoreCandidate({ ...ALL(0), relevance: 1 }).score;
    const freshnessOnly = scoreCandidate({ ...ALL(0), freshness: 1 }).score;
    expect(relevanceOnly).toBeGreaterThan(freshnessOnly);
  });
});

describe('topContributions', () => {
  it('orders inputs by contribution and limits the count', () => {
    const { breakdown } = scoreCandidate({ ...ALL(0), relevance: 1, persona: 1 });
    const top = topContributions(breakdown, 2);
    expect(top.map((t) => t.input)).toEqual(['relevance', 'persona']);
  });
});
