/**
 * Retrieval-quality metrics for the offline harness (KICKOFF Week 6). The
 * acceptance bars (P@1 ≥ 0.70, P@3 ≥ 0.90, Human-AE ≥ 0.75, Coverage ≥ 0.80)
 * live in @allyvate/shared ACCEPTANCE_GATES. Full scenario suite + graph-on/off
 * check land Week 6.
 */

/** Precision@K over a set of (ranked results, expected ids) scenarios. */
export function precisionAtK(
  scenarios: { ranked: string[]; expected: Set<string> }[],
  k: number,
): number {
  if (scenarios.length === 0) return 0;
  const hits = scenarios.filter((s) => s.ranked.slice(0, k).some((id) => s.expected.has(id)));
  return hits.length / scenarios.length;
}
