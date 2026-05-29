import { z } from 'zod';
import { KnowledgeObjectSubtype } from './knowledge-object.js';

/**
 * The Retrieval Intelligence Engine output contract (KICKOFF Stage 3 / Week 4):
 * `{ top_artifact_id, confidence, reasoning_trace, alternatives }`.
 * Both products (Sales Demo, Creative Studio) consume this exact shape.
 */

export const RetrievalQuery = z.object({
  tenantId: z.string().uuid(),
  question: z.string().min(1),
  /** Optional session context for conversation-memory candidate generation. */
  sessionId: z.string().optional(),
  personaHint: z.string().optional(),
  opportunityStage: z.string().optional(),
});
export type RetrievalQuery = z.infer<typeof RetrievalQuery>;

/** Per-input contribution, so the reasoning trace is fully auditable. */
export const ScoreBreakdown = z.object({
  relevance: z.number(),
  persona: z.number(),
  objection: z.number(),
  historicalSuccess: z.number(),
  opportunityStage: z.number(),
  freshness: z.number(),
  approval: z.number(),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdown>;

export const RetrievalCandidate = z.object({
  artifactId: z.string().uuid(),
  subtype: KnowledgeObjectSubtype,
  title: z.string(),
  score: z.number(),
  breakdown: ScoreBreakdown,
});
export type RetrievalCandidate = z.infer<typeof RetrievalCandidate>;

export const RetrievalResult = z.object({
  topArtifactId: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
  reasoningTrace: z.string(),
  alternatives: z.array(RetrievalCandidate),
});
export type RetrievalResult = z.infer<typeof RetrievalResult>;
