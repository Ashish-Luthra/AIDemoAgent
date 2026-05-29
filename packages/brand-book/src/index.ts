/**
 * Brand Book layer (KICKOFF lock #5; Week 7). Markdown is the system of record;
 * this package loads + compiles the per-tenant markdown "constitution" (voice,
 * banned words, compliance, positioning) for injection into the classifier and
 * retrieval-time policy.
 */
export * from './loader.js';

export const PACKAGE = '@allyvate/brand-book';
