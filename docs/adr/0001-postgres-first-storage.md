# 0001 — Postgres-first storage; Neo4j, Qdrant, Graphiti deferred behind triggers

**Status:** Accepted · 28 May 2026
**Phase:** 1

## Context

Prior PRD versions specified Neo4j AuraDB for the knowledge graph and Qdrant Cloud for the vector index as launch-day stores. Two pieces of evidence pushed back on that:

1. **GBrain's production deployment** runs 146,646 pages and 24,585 people on Postgres + pgvector + typed-edge tables with no Neo4j — well past a single Allyvate tenant's full-footprint scale (~1,000–3,000 docs, ~10–30k chunks, ~30–100k edges). Capacity is not the binding constraint for either layer in Phase 1.
2. **Operational surface area.** Three managed stores at launch is three sets of credentials, three migration models, three failure modes, three places to keep tenant isolation policies, and three vendors to negotiate with. Each store earns its place only when a measurable trigger fires.

The graph layer remains architecturally critical — GBrain's measured +31.4-pt P@5 lift from the graph is a strong signal — but the _store_ is a latency question, not a capacity or correctness question.

## Decision

At launch, **one Postgres instance (Neon)** does five jobs:

- pgvector — vector index for hybrid retrieval
- tsvector / pg_trgm — keyword (BM25-style) index for the hybrid keyword arm
- Typed-edge tables + recursive CTEs — relationship graph and multi-hop traversal
- Outcome-weight tables — the ranker's learned memory
- Knowledge Object metadata + episodic / account conversation memory

Neo4j AuraDB, Qdrant, and Graphiti are deferred behind explicit, measurable triggers (PRD §16):

| Layer              | Launch store                         | Graduates to                      | Trigger                                                          |
| ------------------ | ------------------------------------ | --------------------------------- | ---------------------------------------------------------------- |
| Relationship graph | Postgres typed-edge tables + CTEs    | Neo4j AuraDB                      | Real-time multi-hop p95 breaches 590ms under concurrent load     |
| Vector index       | pgvector (same Postgres)             | Qdrant                            | ~1M vectors total, or need for metadata filtering / quantization |
| Temporal validity  | Last-write-wins + admin approval     | Graphiti                          | Stale-fact errors measurable in eval                             |
| Edge inference     | Regex cascade + Claude for ambiguous | (scale workers, not architecture) | Ingestion volume — horizontal worker scaling                     |

The Retrieval Intelligence Engine exposes a single interface across stores. A graduation is a store-adapter swap, not a re-architecture, and not a change to either consuming product (Sales Demo or Creative Studio).

## Consequences

**Good:**

- One Postgres to operate, back up, monitor, and apply RLS to. Tenant isolation lives in one place.
- Faster Phase 1 — no multi-store integration complexity blocking the eval gate.
- Triggers are numeric and falsifiable; the architectural conversation can't drift into preference.
- Both products (Sales Demo and Creative Studio) ride the same substrate without coupling to a specific graph or vector vendor.

**Costs / risks:**

- pgvector + recursive CTEs are slower than purpose-built stores at scale. The 590ms p95 trigger has to be measured continuously, not assumed.
- We carry the indexing cost of running BM25 + vector + graph in one Postgres; pgvector tuning may demand work earlier than expected.
- A graph-on/graph-off P@5 check ships in the eval harness from week 6 — the graph layer's contribution must keep being earned.

**What this rules out for Phase 1:**

- Adding Neo4j, Qdrant, Pinecone, Weaviate, Chroma, Graphiti, or any other store.
- Any architecture that assumes multiple physical stores at launch.

## References

- PRD v3.6 §5.2, §5.8, §10.3, §16
- GBrain — github.com/garrytan/gbrain — production stats verified May 2026
