import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Architectural-lock guard (KICKOFF lock #6): every domain table MUST carry a
 * `tenant_id` column and an RLS policy. CI fails here if that ever regresses.
 * We assert against the schema source text so the check is independent of a live
 * database.
 */
const schemaSource = readFileSync(fileURLToPath(new URL('../schema.ts', import.meta.url)), 'utf8');

const tableNames = [...schemaSource.matchAll(/pgTable\(\s*'([a-z_]+)'/g)].map((m) => m[1]);

describe('schema invariants', () => {
  it('defines exactly the nine Week-1 tables', () => {
    expect(new Set(tableNames)).toEqual(
      new Set([
        'tenants',
        'nodes',
        'edges',
        'knowledge_objects',
        'embeddings',
        'outcome_weights',
        'brand_books',
        'ingestion_runs',
        'provenance',
      ]),
    );
  });

  it('gives every domain table a tenant_id column', () => {
    const domainTableCount = tableNames.filter((n) => n !== 'tenants').length;
    const tenantIdColumns = schemaSource.match(/uuid\('tenant_id'\)/g) ?? [];
    expect(domainTableCount).toBe(8);
    expect(tenantIdColumns).toHaveLength(domainTableCount);
  });

  it('gives every domain table an RLS policy', () => {
    const tenantRlsPolicies = schemaSource.match(/tenantRls\(\)/g) ?? [];
    expect(tenantRlsPolicies).toHaveLength(8);
    // tenants gets its own self-isolation policy.
    expect(schemaSource).toMatch(/tenant_self_isolation/);
  });
});
