/**
 * Postgres-backed Stage-1 retrieval arms (KICKOFF lock #2 / Week 4). One
 * Postgres does three of the five jobs here: pgvector ANN (vector arm), BM25-style
 * full-text + trigram (keyword arm), and recursive-CTE traversal (graph arm).
 *
 * Every query runs inside `withTenant` (sets the `app.current_tenant` GUC for
 * RLS) AND filters `tenant_id` explicitly — defense in depth, since the table
 * owner bypasses RLS. Each arm implements the `CandidateArm` port the RIE
 * consumes, returning a best-first list of knowledge_object ids.
 */
import { sql } from 'drizzle-orm';
import { withTenant, type Database } from '@allyvate/db';
import type { RetrievalQuery } from '@allyvate/shared';
import type { CandidateArm } from '../rie.js';
import type { RankedList } from '../rrf.js';

type IdRow = { id: string };

/** Reads a list of `{ id }` rows from a tenant-scoped query into an id array. */
async function idsFor(
  db: Database,
  tenantId: string,
  build: (tx: Database) => Promise<unknown>,
): Promise<string[]> {
  return withTenant(db, tenantId, async (tx) => {
    const rows = (await build(tx)) as IdRow[];
    return rows.map((r) => r.id);
  });
}

/**
 * Keyword arm — BM25-style ranking over `search_text` + `title` via
 * `to_tsvector`/`websearch_to_tsquery` (`ts_rank`), with a `pg_trgm` similarity
 * fallback so exact product names and fuzzy phrasings both land.
 */
export function createKeywordArm(db: Database): CandidateArm {
  return {
    name: 'keyword',
    async search(query: RetrievalQuery, limit: number): Promise<RankedList> {
      const q = query.question;
      const ids = await idsFor(db, query.tenantId, (tx) =>
        tx.execute(sql`
          SELECT id FROM knowledge_objects
          WHERE tenant_id = ${query.tenantId}
            AND (
              to_tsvector('english', coalesce(search_text, '') || ' ' || title)
                @@ websearch_to_tsquery('english', ${q})
              OR title % ${q}
              OR search_text % ${q}
            )
          ORDER BY
            ts_rank(
              to_tsvector('english', coalesce(search_text, '') || ' ' || title),
              websearch_to_tsquery('english', ${q})
            ) DESC,
            similarity(coalesce(search_text, '') || ' ' || title, ${q}) DESC
          LIMIT ${limit}
        `),
      );
      return { ids };
    },
  };
}

/** Embeds the query text into the index's vector space (OpenAI in prod). */
export type QueryEmbedder = (text: string) => Promise<number[]>;

/**
 * Vector arm — pgvector ANN over the text embeddings, ordered by cosine distance
 * (`<=>`). The query is embedded by the injected `embed` function so the arm
 * stays provider-agnostic (KICKOFF lock #7).
 */
export function createVectorArm(db: Database, embed: QueryEmbedder): CandidateArm {
  return {
    name: 'vector',
    async search(query: RetrievalQuery, limit: number): Promise<RankedList> {
      const vector = await embed(query.question);
      const literal = `[${vector.join(',')}]`;
      const ids = await idsFor(db, query.tenantId, (tx) =>
        tx.execute(sql`
          SELECT ko.id
          FROM embeddings e
          JOIN knowledge_objects ko ON ko.id = e.knowledge_object_id
          WHERE e.tenant_id = ${query.tenantId} AND e.modality = 'text'
          ORDER BY e.embedding <=> ${literal}::vector
          LIMIT ${limit}
        `),
      );
      return { ids };
    },
  };
}

/**
 * Graph arm — recursive-CTE traversal. Seeds are nodes whose canonical name is
 * mentioned in the question; the walk follows typed edges up to `maxDepth` hops,
 * then maps reached nodes to their Knowledge Objects, ranked by hop distance.
 * This is the layer the Week-6 graph-on/off check measures.
 */
export function createGraphArm(db: Database, maxDepth = 2): CandidateArm {
  return {
    name: 'graph',
    async search(query: RetrievalQuery, limit: number): Promise<RankedList> {
      const ids = await idsFor(db, query.tenantId, (tx) =>
        tx.execute(sql`
          WITH RECURSIVE seeds AS (
            SELECT id FROM nodes
            WHERE tenant_id = ${query.tenantId}
              AND ${query.question} ILIKE '%' || canonical_name || '%'
          ),
          walk AS (
            SELECT id AS node_id, 0 AS depth FROM seeds
            UNION
            SELECT e.target_node_id, w.depth + 1
            FROM walk w
            JOIN edges e ON e.source_node_id = w.node_id AND e.tenant_id = ${query.tenantId}
            WHERE w.depth < ${maxDepth}
          )
          SELECT ko.id
          FROM walk w
          JOIN knowledge_objects ko ON ko.node_id = w.node_id AND ko.tenant_id = ${query.tenantId}
          GROUP BY ko.id
          ORDER BY min(w.depth) ASC
          LIMIT ${limit}
        `),
      );
      return { ids };
    },
  };
}
