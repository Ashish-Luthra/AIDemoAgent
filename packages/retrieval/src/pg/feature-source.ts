/**
 * Postgres-backed FeatureSource (KICKOFF Stage 2 inputs / Week 4). Loads the
 * data-derived scoring signals for a set of candidate Knowledge Objects:
 * subtype/title/tags plus normalized approval, freshness, opportunity-stage, and
 * historical-success values. Tenant-scoped via `withTenant` + explicit filter.
 *
 * `historicalSuccess` and `opportunityStageFit` are neutral placeholders until
 * the Outcome Reinforcement Engine (Week 5) populates `outcome_weights`.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { knowledgeObjects, withTenant, type Database } from '@allyvate/db';
import type { ArtifactFeatures, FeatureSource } from '../rie.js';

/** Approval state → [0,1] signal. Approved content is preferred at retrieval time. */
const APPROVAL_SCORE: Record<string, number> = {
  approved: 1,
  pending: 0.5,
  draft: 0.25,
  archived: 0,
};

/** Exponential recency decay with a ~180-day half-life, clamped to [0,1]. */
function freshnessScore(at: Date, now: number): number {
  const ageMs = now - at.getTime();
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  const halfLifeMs = 180 * 24 * 60 * 60 * 1000;
  return Math.min(1, Math.max(0, 2 ** (-ageMs / halfLifeMs)));
}

export interface PgFeatureSourceOptions {
  /** Injectable clock for deterministic freshness in tests. Defaults to Date.now. */
  now?: () => number;
}

export function createPgFeatureSource(
  db: Database,
  opts: PgFeatureSourceOptions = {},
): FeatureSource {
  const now = opts.now ?? Date.now;
  return {
    async features(
      tenantId: string,
      artifactIds: string[],
    ): Promise<Map<string, ArtifactFeatures>> {
      const out = new Map<string, ArtifactFeatures>();
      if (artifactIds.length === 0) return out;

      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .select({
            id: knowledgeObjects.id,
            subtype: knowledgeObjects.subtype,
            title: knowledgeObjects.title,
            personaTags: knowledgeObjects.personaTags,
            objectionTags: knowledgeObjects.objectionTags,
            approval: knowledgeObjects.approval,
            freshnessAt: knowledgeObjects.freshnessAt,
          })
          .from(knowledgeObjects)
          .where(
            and(eq(knowledgeObjects.tenantId, tenantId), inArray(knowledgeObjects.id, artifactIds)),
          ),
      );

      for (const r of rows) {
        out.set(r.id, {
          artifactId: r.id,
          subtype: r.subtype,
          title: r.title,
          personaTags: r.personaTags ?? [],
          objectionTags: r.objectionTags ?? [],
          historicalSuccess: 0, // populated by the Outcome Reinforcement Engine (Week 5)
          opportunityStageFit: 0.5, // neutral until stage metadata is modeled
          freshness: freshnessScore(r.freshnessAt, now()),
          approval: APPROVAL_SCORE[r.approval] ?? 0,
        });
      }
      return out;
    },
  };
}
