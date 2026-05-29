import { z } from 'zod';

/**
 * Knowledge-graph node and edge vocabulary. The graph lives in Postgres
 * typed-edge tables at launch (ADR 0001); these enums are the typed contract the
 * regex cascade and Claude classifier both write against.
 */

/** Node types. KO subtypes (see knowledge-object.ts) are stored as Asset nodes. */
export const NODE_TYPES = ['Asset', 'Concept', 'Persona', 'ObjectionType'] as const;
export const NodeType = z.enum(NODE_TYPES);
export type NodeType = z.infer<typeof NodeType>;

/** Edge types. The first three are typed by the deterministic regex cascade. */
export const EDGE_TYPES = [
  'USES',
  'INTEGRATES_WITH',
  'FOR_PERSONA',
  'ADDRESSES',
  'RELEVANT_FOR',
  'COUNTERED_BY',
] as const;
export const EdgeType = z.enum(EDGE_TYPES);
export type EdgeType = z.infer<typeof EdgeType>;

/** How an edge was inferred — provenance for every edge (KICKOFF lock #3). */
export const EDGE_INFERENCE_METHODS = ['regex', 'claude', 'manual'] as const;
export const EdgeInferenceMethod = z.enum(EDGE_INFERENCE_METHODS);
export type EdgeInferenceMethod = z.infer<typeof EdgeInferenceMethod>;

export const GraphNode = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  type: NodeType,
  canonicalName: z.string().min(1),
  aliases: z.array(z.string()).default([]),
});
export type GraphNode = z.infer<typeof GraphNode>;

export const GraphEdge = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  type: EdgeType,
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
  inferenceMethod: EdgeInferenceMethod,
  /** Outcome-weighted; updated by the Outcome Reinforcement Engine (EWMA). */
  weight: z.number().default(1),
});
export type GraphEdge = z.infer<typeof GraphEdge>;
