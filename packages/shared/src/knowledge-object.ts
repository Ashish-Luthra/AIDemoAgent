import { z } from 'zod';

/**
 * Knowledge Objects are typed business objects, not generic text chunks
 * (KICKOFF § Knowledge Object model). The Claude classifier emits one of these
 * subtypes as a Zod-validated structured output — no free-form parsing.
 */

export const KO_SUBTYPES = [
  'ObjectionHandler',
  'PricingClaim',
  'ROIStory',
  'CaseStudy',
  'ImplementationPath',
  'SecurityResponse',
  'CompetitorCounter',
  'FeatureExplanation',
] as const;
export const KnowledgeObjectSubtype = z.enum(KO_SUBTYPES);
export type KnowledgeObjectSubtype = z.infer<typeof KnowledgeObjectSubtype>;

/** Approval lifecycle — gates what retrieval is allowed to surface. */
export const APPROVAL_STATES = ['draft', 'pending', 'approved', 'archived'] as const;
export const ApprovalState = z.enum(APPROVAL_STATES);
export type ApprovalState = z.infer<typeof ApprovalState>;

/** Provenance backpointer — every KO traces to its source (KICKOFF lock). */
export const Provenance = z.object({
  sourceSystem: z.enum(['website', 'confluence', 'gdrive', 'hubspot', 'salesforce', 'manual']),
  sourceUri: z.string(),
  ingestionRunId: z.string().uuid().optional(),
  extractedAt: z.string().datetime(),
});
export type Provenance = z.infer<typeof Provenance>;

export const KnowledgeObject = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  subtype: KnowledgeObjectSubtype,
  title: z.string().min(1),
  body: z.string(),
  approval: ApprovalState.default('draft'),
  /** Persona / objection / concept associations resolved during classification. */
  personaTags: z.array(z.string()).default([]),
  objectionTags: z.array(z.string()).default([]),
  provenance: Provenance,
});
export type KnowledgeObject = z.infer<typeof KnowledgeObject>;

/**
 * The structured output contract the Claude ingestion classifier must satisfy.
 * Validated with this schema before anything is written to the index.
 */
export const ClassifierOutput = z.object({
  subtype: KnowledgeObjectSubtype,
  title: z.string().min(1),
  summary: z.string(),
  personaTags: z.array(z.string()),
  objectionTags: z.array(z.string()),
  /** Ambiguous edges the regex cascade could not type (KICKOFF lock #3). */
  inferredEdges: z.array(
    z.object({
      type: z.string(),
      targetCanonicalName: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  confidence: z.number().min(0).max(1),
});
export type ClassifierOutput = z.infer<typeof ClassifierOutput>;
