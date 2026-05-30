/**
 * Allyvate Brain — initial Drizzle schema (Phase 1, Week 1).
 *
 * Nine tables. ONE Postgres instance does five jobs (ADR 0001): pgvector,
 * tsvector/pg_trgm keyword search, typed-edge graph, outcome-weight tables, and
 * Knowledge Object + memory metadata.
 *
 * MULTI-TENANCY (KICKOFF lock #6): every domain table has `tenant_id` and an
 * RLS policy. Isolation keys off the `app.current_tenant` GUC, set per request
 * (see rls.ts). CI fails if any table drops either — see
 * src/__tests__/schema-invariants.test.ts.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import type {
  ApprovalState,
  EdgeInferenceMethod,
  EdgeType,
  KnowledgeObjectSubtype,
  NodeType,
} from '@allyvate/shared';

/**
 * Mirror of `DEFAULT_MODELS.textEmbeddingDimensions` (@allyvate/shared) — kept as
 * a local literal so drizzle-kit can load this schema without resolving the
 * shared package's runtime exports. The schema-invariants test asserts the two
 * stay in sync. 1536 keeps us under pgvector's HNSW 2000-dim ceiling.
 */
const TEXT_EMBEDDING_DIMENSIONS = 1536;

type IngestionSource = 'website' | 'confluence' | 'gdrive' | 'hubspot' | 'salesforce' | 'manual';
type IngestionStatus = 'queued' | 'running' | 'succeeded' | 'failed';
type ProvenanceSubject = 'node' | 'edge' | 'knowledge_object';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** RLS predicate for any table keyed by `tenant_id`. Fresh fragment per call. */
const isTenant = () => sql`tenant_id = current_setting('app.current_tenant', true)::uuid`;
/** Standard tenant-isolation policy. Defining a policy auto-enables RLS. */
const tenantRls = () =>
  pgPolicy('tenant_isolation', {
    for: 'all',
    to: 'public',
    using: isTenant(),
    withCheck: isTenant(),
  });

const emptyTextArray = sql`'{}'::text[]`;

// ── 1. tenants — the multi-tenant root (KICKOFF lock #6) ─────────────────────
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('tenants_slug_idx').on(t.slug),
    // A tenant row is visible only to its own context.
    pgPolicy('tenant_self_isolation', {
      for: 'all',
      to: 'public',
      using: sql`id = current_setting('app.current_tenant', true)::uuid`,
      withCheck: sql`id = current_setting('app.current_tenant', true)::uuid`,
    }),
  ],
);

// ── 2. nodes — graph vertices (Asset, Concept, Persona, ObjectionType) ───────
export const nodes = pgTable(
  'nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    type: text('type').$type<NodeType>().notNull(),
    canonicalName: text('canonical_name').notNull(),
    aliases: text('aliases').array().notNull().default(emptyTextArray),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('nodes_tenant_canonical_idx').on(t.tenantId, t.canonicalName),
    index('nodes_tenant_type_idx').on(t.tenantId, t.type),
    tenantRls(),
  ],
);

// ── 3. edges — typed, outcome-weighted graph edges + recursive-CTE traversal ─
export const edges = pgTable(
  'edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    type: text('type').$type<EdgeType>().notNull(),
    sourceNodeId: uuid('source_node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    targetNodeId: uuid('target_node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    inferenceMethod: text('inference_method').$type<EdgeInferenceMethod>().notNull(),
    /** Tuned by the Outcome Reinforcement Engine (EWMA updates). */
    weight: real('weight').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index('edges_tenant_source_idx').on(t.tenantId, t.sourceNodeId),
    index('edges_tenant_target_idx').on(t.tenantId, t.targetNodeId),
    index('edges_tenant_type_idx').on(t.tenantId, t.type),
    tenantRls(),
  ],
);

// ── 4. knowledge_objects — typed business objects (not generic chunks) ───────
export const knowledgeObjects = pgTable(
  'knowledge_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** The Asset node this KO materializes as, if resolved. */
    nodeId: uuid('node_id').references(() => nodes.id, { onDelete: 'set null' }),
    subtype: text('subtype').$type<KnowledgeObjectSubtype>().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    approval: text('approval').$type<ApprovalState>().notNull().default('draft'),
    personaTags: text('persona_tags').array().notNull().default(emptyTextArray),
    objectionTags: text('objection_tags').array().notNull().default(emptyTextArray),
    /** Keyword arm of hybrid retrieval (BM25-style via tsvector/pg_trgm). */
    searchText: text('search_text').notNull().default(''),
    /** Drives the freshness scoring input. */
    freshnessAt: timestamp('freshness_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index('ko_tenant_subtype_idx').on(t.tenantId, t.subtype),
    index('ko_tenant_approval_idx').on(t.tenantId, t.approval),
    tenantRls(),
  ],
);

// ── 5. embeddings — pgvector index (the vector arm of hybrid retrieval) ──────
export const embeddings = pgTable(
  'embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    knowledgeObjectId: uuid('knowledge_object_id')
      .notNull()
      .references(() => knowledgeObjects.id, { onDelete: 'cascade' }),
    modality: text('modality').$type<'text' | 'image'>().notNull().default('text'),
    // 1536 dims keeps us inside pgvector's HNSW 2000-dim ceiling — see
    // TEXT_EMBEDDING_DIMENSIONS (mirrors DEFAULT_MODELS.textEmbeddingDimensions).
    embedding: vector('embedding', {
      dimensions: TEXT_EMBEDDING_DIMENSIONS,
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('embeddings_tenant_ko_idx').on(t.tenantId, t.knowledgeObjectId),
    index('embeddings_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    tenantRls(),
  ],
);

// ── 6. outcome_weights — the ranker's learned memory (per tenant) ────────────
export const outcomeWeights = pgTable(
  'outcome_weights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** What the weight applies to: a graph edge, or a scoring input. */
    targetType: text('target_type').$type<'edge' | 'scoring_input'>().notNull(),
    targetId: text('target_id').notNull(),
    weight: real('weight').notNull().default(1),
    /** Reward/penalty observations folded into the EWMA. */
    sampleCount: integer('sample_count').notNull().default(0),
    decayAppliedAt: timestamp('decay_applied_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('outcome_weights_target_idx').on(t.tenantId, t.targetType, t.targetId),
    tenantRls(),
  ],
);

// ── 7. brand_books — per-tenant compiled markdown constitution ───────────────
export const brandBooks = pgTable(
  'brand_books',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    /** Markdown is the system of record; this column is a derived cache. */
    markdown: text('markdown').notNull().default(''),
    isActive: boolean('is_active').notNull().default(false),
    compiledAt: timestamp('compiled_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index('brand_books_tenant_active_idx').on(t.tenantId, t.isActive),
    uniqueIndex('brand_books_tenant_version_idx').on(t.tenantId, t.version),
    tenantRls(),
  ],
);

// ── 8. ingestion_runs — one row per source ingestion pass ────────────────────
export const ingestionRuns = pgTable(
  'ingestion_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    source: text('source').$type<IngestionSource>().notNull(),
    status: text('status').$type<IngestionStatus>().notNull().default('queued'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    stats: jsonb('stats').$type<Record<string, unknown>>(),
    error: text('error'),
    ...timestamps,
  },
  (t) => [index('ingestion_runs_tenant_status_idx').on(t.tenantId, t.status), tenantRls()],
);

// ── 9. provenance — backpointers on every node, edge, and KO ─────────────────
export const provenance = pgTable(
  'provenance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').$type<ProvenanceSubject>().notNull(),
    subjectId: uuid('subject_id').notNull(),
    sourceSystem: text('source_system').$type<IngestionSource>().notNull(),
    sourceUri: text('source_uri').notNull(),
    ingestionRunId: uuid('ingestion_run_id').references(() => ingestionRuns.id, {
      onDelete: 'set null',
    }),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('provenance_tenant_subject_idx').on(t.tenantId, t.subjectType, t.subjectId),
    tenantRls(),
  ],
);

export const schema = {
  tenants,
  nodes,
  edges,
  knowledgeObjects,
  embeddings,
  outcomeWeights,
  brandBooks,
  ingestionRuns,
  provenance,
};
