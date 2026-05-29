import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { knowledgeObjects, nodes, tenants } from './schema.js';

/**
 * Minimal Phase-1 seed: one pilot tenant plus a couple of nodes / Knowledge
 * Objects so the Brain UI and eval harness have something to retrieve against.
 * Runs as the table owner, which bypasses RLS by design.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required to seed');

const { db, client } = createDb(url, { max: 1 });

await db.insert(tenants).values({ name: 'Acme Pilot', slug: 'acme-pilot' }).onConflictDoNothing();
const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'acme-pilot')).limit(1);
if (!tenant) throw new Error('failed to create or find the seed tenant');

const [assetNode] = await db
  .insert(nodes)
  .values({
    tenantId: tenant.id,
    type: 'Asset',
    canonicalName: 'Match Booster',
    aliases: ['MatchBooster™', 'identity resolution'],
  })
  .onConflictDoNothing()
  .returning();

await db
  .insert(knowledgeObjects)
  .values({
    tenantId: tenant.id,
    nodeId: assetNode?.id ?? null,
    subtype: 'CaseStudy',
    title: 'Match Booster lifts match rate 31% at a Fortune 500 retailer',
    body: 'A worked example of identity resolution improving downstream targeting.',
    approval: 'approved',
    searchText: 'match booster identity resolution case study retail 31% lift',
  })
  .onConflictDoNothing();

await client.end();
console.log(`✓ seeded tenant ${tenant.slug} (${tenant.id})`);
