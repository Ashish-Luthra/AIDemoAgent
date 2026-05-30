/**
 * Stage 2 of the Retrieval Intelligence Engine — weighted scoring (KICKOFF
 * Stage 2 / Week 4). Seven inputs, each normalized to [0,1], combined with the
 * locked `SCORING_WEIGHTS` (which sum to 1.0). The per-input contribution is
 * preserved as a `ScoreBreakdown` so the reasoning trace is fully auditable.
 *
 * Pure function — the Outcome Reinforcement Engine (Week 5) tunes the weights
 * per tenant; this module just applies whatever weights it's given.
 */
import { SCORING_WEIGHTS, type ScoreBreakdown, type ScoringInput } from '@allyvate/shared';

/** The seven scoring inputs, each expected in [0,1]. */
export type ScoreInputs = Record<ScoringInput, number>;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Computes the weighted score and the per-input contribution breakdown.
 * `breakdown[input] = weight[input] * clamp01(inputs[input])`, and the score is
 * the sum of contributions — so with all weights summing to 1.0, the score is
 * itself in [0,1] and doubles as a confidence value.
 */
export function scoreCandidate(
  inputs: ScoreInputs,
  weights: Record<ScoringInput, number> = SCORING_WEIGHTS,
): { score: number; breakdown: ScoreBreakdown } {
  const breakdown = {} as ScoreBreakdown;
  let score = 0;
  for (const key of Object.keys(weights) as ScoringInput[]) {
    const contribution = weights[key] * clamp01(inputs[key]);
    breakdown[key] = contribution;
    score += contribution;
  }
  return { score, breakdown };
}

/** Returns the inputs sorted by contribution (weight × value), highest first. */
export function topContributions(
  breakdown: ScoreBreakdown,
  limit = 3,
): { input: ScoringInput; contribution: number }[] {
  return (Object.keys(breakdown) as ScoringInput[])
    .map((input) => ({ input, contribution: breakdown[input] }))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, limit);
}
