/**
 * Reciprocal Rank Fusion — merges the vector and keyword (BM25) arms of hybrid
 * search into one ranking before reranking (KICKOFF lock #2, Stage 1 / Week 4).
 * Pure function, no I/O — the rest of the RIE wraps it.
 */
export interface RankedList {
  /** Ordered best-first list of candidate ids. */
  ids: string[];
}

export function reciprocalRankFusion(lists: RankedList[], k = 60): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.ids.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
