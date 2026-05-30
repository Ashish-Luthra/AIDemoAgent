/**
 * Postgres adapters for the Retrieval Intelligence Engine — assembles the
 * concrete arms + feature source into the `RetrievalDeps` the RIE consumes
 * (KICKOFF Week 4). The vector arm is included only when a query embedder is
 * supplied; keyword and graph arms always run.
 */
import type { Database } from '@allyvate/db';
import type { CandidateArm, Reranker, RetrievalDeps } from '../rie.js';
import { createGraphArm, createKeywordArm, createVectorArm, type QueryEmbedder } from './arms.js';
import { createPgFeatureSource, type PgFeatureSourceOptions } from './feature-source.js';

export * from './arms.js';
export * from './feature-source.js';

export interface PgRetrievalOptions {
  /** When provided, the pgvector arm is enabled (query is embedded with this). */
  embed?: QueryEmbedder;
  /** Optional reranker (e.g. Cohere) applied to the fused top slice. */
  reranker?: Reranker;
  /** Graph traversal depth. Default 2. */
  graphDepth?: number;
  candidateLimit?: number;
  feature?: PgFeatureSourceOptions;
}

/**
 * Builds RetrievalDeps backed by the live Postgres index. Pass the result
 * straight to `runRetrieval(query, deps)`.
 */
export function createPgRetrievalDeps(db: Database, opts: PgRetrievalOptions = {}): RetrievalDeps {
  const arms: CandidateArm[] = [createKeywordArm(db), createGraphArm(db, opts.graphDepth)];
  if (opts.embed) arms.unshift(createVectorArm(db, opts.embed));
  return {
    arms,
    features: createPgFeatureSource(db, opts.feature),
    reranker: opts.reranker,
    candidateLimit: opts.candidateLimit,
  };
}
