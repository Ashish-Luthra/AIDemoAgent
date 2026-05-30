import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { createDb, edges, knowledgeObjects, nodes, tenants, type Database } from '@allyvate/db';
import type { RetrievalQuery } from '@allyvate/shared';
import { runRetrieval } from '../../rie.js';
import { createGraphArm, createKeywordArm, createVectorArm } from '../arms.js';
import { createPgFeatureSource } from '../feature-source.js';
import { createPgRetrievalDeps } from '../index.js';

// Integration tests require a live Postgres (pgvector + pg_trgm). CI has none, so
// they skip there; run locally with DATABASE_URL pointed at the dev DB.
const DATABASE_URL = process.env.DATABASE_URL;
const SLUG = 'rie-itest';

/** A 1536-dim unit vector with a 1 at `i` — distinct, comparable embeddings. */
function unit(i: number): number[] {
  const v = new Array(1536).fill(0);
  v[i] = 1;
  return v;
}
const vecLiteral = (v: number[]): string => `[${v.join(',')}]`;

describe.skipIf(!DATABASE_URL)('pg retrieval arms (integration)', () => {
  let db: Database;
  let client: ReturnType<typeof createDb>['client'];
  let tenantId: string;
  const ko: Record<string, string> = {};

  beforeAll(async () => {
    ({ db, client } = createDb(DATABASE_URL!, { max: 4 }));

    // Fresh tenant (cascades clean up any prior run).
    await db.delete(tenants).where(eq(tenants.slug, SLUG));
    const [t] = await db.insert(tenants).values({ name: 'RIE Itest', slug: SLUG }).returning();
    tenantId = t!.id;

    const [matchBooster] = await db
      .insert(nodes)
      .values({ tenantId, type: 'Asset', canonicalName: 'Match Booster', aliases: [] })
      .returning();
    const [identityGraph] = await db
      .insert(nodes)
      .values({ tenantId, type: 'Concept', canonicalName: 'Identity Graph', aliases: [] })
      .returning();
    await db.insert(edges).values({
      tenantId,
      type: 'USES',
      sourceNodeId: matchBooster!.id,
      targetNodeId: identityGraph!.id,
      inferenceMethod: 'regex',
    });

    const rows = await db
      .insert(knowledgeObjects)
      .values([
        {
          tenantId,
          nodeId: matchBooster!.id,
          subtype: 'PricingClaim',
          title: 'Match Booster pricing and ROI',
          searchText: 'match booster pricing roi value',
          approval: 'approved',
        },
        {
          tenantId,
          subtype: 'FeatureExplanation',
          title: 'Generic onboarding guide',
          searchText: 'onboarding setup steps walkthrough',
          approval: 'draft',
        },
        {
          tenantId,
          nodeId: identityGraph!.id,
          subtype: 'CaseStudy',
          title: 'Identity Graph case study',
          searchText: 'identity resolution graph lift',
          approval: 'approved',
        },
      ])
      .returning();
    ko.pricing = rows[0]!.id;
    ko.onboarding = rows[1]!.id;
    ko.identity = rows[2]!.id;

    // Embeddings: pricing KO at unit(0), onboarding KO at unit(1).
    await db.execute(sql`
      INSERT INTO embeddings (tenant_id, knowledge_object_id, modality, embedding)
      VALUES
        (${tenantId}, ${ko.pricing}, 'text', ${vecLiteral(unit(0))}::vector),
        (${tenantId}, ${ko.onboarding}, 'text', ${vecLiteral(unit(1))}::vector)
    `);
  });

  afterAll(async () => {
    if (db) await db.delete(tenants).where(eq(tenants.slug, SLUG));
    if (client) await client.end();
  });

  const query = (over: Partial<RetrievalQuery> = {}): RetrievalQuery => ({
    tenantId,
    question: 'match booster pricing',
    ...over,
  });

  it('keyword arm ranks the lexically-matching KO first', async () => {
    const { ids } = await createKeywordArm(db).search(query(), 10);
    expect(ids[0]).toBe(ko.pricing);
    expect(ids).not.toContain(ko.onboarding);
  });

  it('vector arm returns the nearest embedding by cosine distance', async () => {
    const arm = createVectorArm(db, async () => unit(0));
    const { ids } = await arm.search(query(), 10);
    expect(ids[0]).toBe(ko.pricing);
  });

  it('graph arm traverses from a named seed node to connected KOs', async () => {
    const { ids } = await createGraphArm(db).search(
      query({ question: 'tell me about Match Booster' }),
      10,
    );
    // Seed "Match Booster" (depth 0 → pricing KO) → USES → "Identity Graph" (depth 1 → identity KO).
    expect(ids).toContain(ko.pricing);
    expect(ids).toContain(ko.identity);
  });

  it('feature source maps approval and freshness for candidates', async () => {
    const features = createPgFeatureSource(db);
    const map = await features.features(tenantId, [ko.pricing!, ko.onboarding!]);
    expect(map.get(ko.pricing!)?.approval).toBe(1); // approved
    expect(map.get(ko.onboarding!)?.approval).toBe(0.25); // draft
    expect(map.get(ko.pricing!)?.freshness).toBeGreaterThan(0.9); // just inserted
  });

  it('runs the full RIE over the live index and selects a top artifact', async () => {
    const deps = createPgRetrievalDeps(db, { embed: async () => unit(0) });
    const result = await runRetrieval(query(), deps);
    expect(result.topArtifactId).toBe(ko.pricing);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.reasoningTrace).toContain('Match Booster pricing');
  });
});
