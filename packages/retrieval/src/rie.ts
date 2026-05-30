/**
 * Retrieval Intelligence Engine — the three-stage retrieval pipeline (KICKOFF
 * Stages 1–3 / Week 4).
 *
 *   Stage 1  Candidate generation — every arm (vector, keyword/BM25, graph,
 *            memory) returns a ranked id list; Reciprocal Rank Fusion merges
 *            them; an optional reranker reorders the top slice.
 *   Stage 2  Weighted scoring — seven inputs per candidate (see scoring.ts).
 *   Stage 3  Selection — top artifact + confidence + reasoning trace + ranked
 *            alternatives (the `RetrievalResult` contract).
 *
 * The arms, reranker, and feature source are PORTS injected by the caller, so
 * the engine is pure orchestration and fully testable without a database. The
 * pgvector / BM25 / recursive-CTE adapters implement these ports (they need a
 * live Postgres and are wired in separately).
 */
import {
  type KnowledgeObjectSubtype,
  type RetrievalCandidate,
  type RetrievalQuery,
  type RetrievalResult,
} from '@allyvate/shared';
import { reciprocalRankFusion, type RankedList } from './rrf.js';
import { scoreCandidate, topContributions, type ScoreInputs } from './scoring.js';

/** One retrieval arm (Stage 1). `name === 'graph'` is special-cased by graph on/off. */
export interface CandidateArm {
  readonly name: string;
  search(query: RetrievalQuery, limit: number): Promise<RankedList>;
}

/** Reranker port — the precision arm of hybrid search (Cohere by default). */
export interface Reranker {
  rerank(
    query: string,
    candidateIds: string[],
    limit: number,
  ): Promise<{ id: string; relevanceScore: number }[]>;
}

/** Per-artifact signals the engine needs to score a candidate (data-derived). */
export interface ArtifactFeatures {
  artifactId: string;
  subtype: KnowledgeObjectSubtype;
  title: string;
  personaTags: string[];
  objectionTags: string[];
  /** Learned success rate from the Outcome Reinforcement Engine, [0,1]. */
  historicalSuccess: number;
  /** How well the artifact fits the query's opportunity stage, [0,1]. */
  opportunityStageFit: number;
  /** Recency signal derived from `freshness_at`, [0,1]. */
  freshness: number;
  /** Approval-state signal (approved → high), [0,1]. */
  approval: number;
}

/** Loads features for a set of candidate artifacts (tenant-scoped). */
export interface FeatureSource {
  features(tenantId: string, artifactIds: string[]): Promise<Map<string, ArtifactFeatures>>;
}

export interface RetrievalDeps {
  arms: CandidateArm[];
  features: FeatureSource;
  reranker?: Reranker;
  /** Candidates carried into scoring after fusion/rerank. Default 20. */
  candidateLimit?: number;
  /** When false, arms named `graph` are skipped (graph-on/off eval). Default true. */
  graphEnabled?: boolean;
}

/** Persona hint vs the artifact's persona tags. Neutral (0.5) when no hint given. */
function personaFit(hint: string | undefined, tags: string[]): number {
  if (!hint) return 0.5;
  const h = hint.toLowerCase();
  return tags.some((t) => {
    const tl = t.toLowerCase();
    return tl === h || tl.includes(h) || h.includes(tl);
  })
    ? 1
    : 0;
}

/** Objection relevance: does the question mention one of the artifact's objection tags? */
function objectionFit(question: string, tags: string[]): number {
  if (tags.length === 0) return 0;
  const q = question.toLowerCase();
  return tags.some((t) => q.includes(t.toLowerCase())) ? 1 : 0.2;
}

/** Runs the full three-stage pipeline and returns the RetrievalResult contract. */
export async function runRetrieval(
  query: RetrievalQuery,
  deps: RetrievalDeps,
): Promise<RetrievalResult> {
  const candidateLimit = deps.candidateLimit ?? 20;
  const graphEnabled = deps.graphEnabled ?? true;

  // ── Stage 1: candidate generation ──────────────────────────────────────────
  const arms = deps.arms.filter((a) => graphEnabled || a.name !== 'graph');
  const lists = await Promise.all(arms.map((a) => a.search(query, candidateLimit)));
  const fused = reciprocalRankFusion(lists);

  // Optional rerank of the fused top slice; otherwise the RRF score is the hybrid score.
  let hybrid: { id: string; hybridScore: number }[];
  if (deps.reranker && fused.length > 0) {
    const reranked = await deps.reranker.rerank(
      query.question,
      fused.slice(0, candidateLimit).map((f) => f.id),
      candidateLimit,
    );
    hybrid = reranked.map((r) => ({ id: r.id, hybridScore: r.relevanceScore }));
  } else {
    hybrid = fused.slice(0, candidateLimit).map((f) => ({ id: f.id, hybridScore: f.score }));
  }

  if (hybrid.length === 0) return emptyResult();

  const maxHybrid = Math.max(...hybrid.map((h) => h.hybridScore)) || 1;

  // ── Stage 2: weighted scoring ──────────────────────────────────────────────
  const featureMap = await deps.features.features(
    query.tenantId,
    hybrid.map((h) => h.id),
  );

  const candidates: RetrievalCandidate[] = [];
  for (const { id, hybridScore } of hybrid) {
    const f = featureMap.get(id);
    if (!f) continue; // candidate without resolvable features is dropped
    const inputs: ScoreInputs = {
      relevance: hybridScore / maxHybrid,
      persona: personaFit(query.personaHint, f.personaTags),
      objection: objectionFit(query.question, f.objectionTags),
      historicalSuccess: f.historicalSuccess,
      opportunityStage: f.opportunityStageFit,
      freshness: f.freshness,
      approval: f.approval,
    };
    const { score, breakdown } = scoreCandidate(inputs);
    candidates.push({
      artifactId: f.artifactId,
      subtype: f.subtype,
      title: f.title,
      score,
      breakdown,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  // ── Stage 3: selection ─────────────────────────────────────────────────────
  if (candidates.length === 0) return emptyResult();
  const top = candidates[0]!;
  const confidence = clamp01(top.score);
  const reasoningTrace = buildTrace(top, candidates.length);
  return {
    topArtifactId: top.artifactId,
    confidence,
    reasoningTrace,
    // Ranked fallback chain — everything below the winner.
    alternatives: candidates.slice(1),
  };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function emptyResult(): RetrievalResult {
  return {
    topArtifactId: null,
    confidence: 0,
    reasoningTrace: 'No candidates were generated for this query.',
    alternatives: [],
  };
}

function buildTrace(top: RetrievalCandidate, total: number): string {
  const signals = topContributions(top.breakdown)
    .map(({ input, contribution }) => `${input} ${contribution.toFixed(3)}`)
    .join(', ');
  const others = total - 1;
  return (
    `Selected "${top.title}" (${top.subtype}) with weighted score ${top.score.toFixed(3)}. ` +
    `Top signals: ${signals}. ${others} alternative${others === 1 ? '' : 's'} considered.`
  );
}
