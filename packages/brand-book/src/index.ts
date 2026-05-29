/**
 * Brand Book layer (KICKOFF Week 7). Markdown is the system of record (lock #5);
 * this package loads + compiles the per-tenant markdown "constitution" (voice,
 * banned words, compliance, positioning) for injection into the classifier and
 * retrieval-time policy. Full loader/compiler lands Week 7.
 */
export interface BrandBook {
  tenantId: string;
  version: number;
  markdown: string;
}

export const PACKAGE = '@allyvate/brand-book';
