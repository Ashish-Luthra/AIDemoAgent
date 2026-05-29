/**
 * System-wide constants. These are architectural locks from KICKOFF.md and the
 * PRD — changing the scoring weights or model defaults is a tuning decision, not
 * a casual edit.
 */

/**
 * Stage-2 weighted scoring inputs for the Retrieval Intelligence Engine.
 * Seven inputs, must sum to 1.0 (enforced by a unit test). v1 heuristics;
 * tuned per tenant by the Outcome Reinforcement Engine. (PRD §; KICKOFF Stage 2)
 */
export const SCORING_WEIGHTS = {
  relevance: 0.3, // hybrid: vector + BM25 + RRF + reranker
  persona: 0.2,
  objection: 0.15,
  historicalSuccess: 0.15,
  opportunityStage: 0.1,
  freshness: 0.05,
  approval: 0.05,
} as const;

export type ScoringInput = keyof typeof SCORING_WEIGHTS;

/** Phase 1 acceptance gates (KICKOFF § Definition of Done). */
export const ACCEPTANCE_GATES = {
  precisionAt1: 0.7,
  precisionAt3: 0.9,
  humanAeBenchmark: 0.75,
  coverage: 0.8,
  /** Graph-on vs graph-off must show at least this P@5 improvement. */
  graphP5LiftPoints: 5,
  /** Text-mode retrieval p95 latency budget, milliseconds. */
  retrievalP95Ms: 500,
} as const;

/**
 * Graduation triggers for deferred stores (ADR 0001 / PRD §16). These are
 * numeric and falsifiable on purpose — do NOT add Neo4j/Qdrant/Graphiti until a
 * trigger measurably fires.
 */
export const GRADUATION_TRIGGERS = {
  /** Graph → Neo4j AuraDB when real-time multi-hop p95 breaches this (ms). */
  neo4jMultiHopP95Ms: 590,
  /** Vector → Qdrant at ~1M vectors total, or on metadata-filtering need. */
  qdrantVectorCount: 1_000_000,
} as const;

/** Default model identifiers (provider-abstracted; override via env). */
export const DEFAULT_MODELS = {
  llm: 'claude-sonnet-4-6',
  textEmbedding: 'text-embedding-3-large',
  /**
   * 1536, not the model's native 3072. pgvector's HNSW index caps at 2000
   * dimensions; text-embedding-3-large supports API-side dimension reduction, so
   * we request 1536 to stay indexable. Revisit if/when we graduate to Qdrant
   * (GRADUATION_TRIGGERS.qdrantVectorCount) where higher dims are cheap.
   */
  textEmbeddingDimensions: 1536,
  reranker: 'rerank-english-v3.0',
} as const;
