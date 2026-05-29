# Allyvate — AI Demo Agent

Revenue infrastructure for the agentic era. A voice-first AI sales demo agent backed by a typed-edge knowledge graph + hybrid retrieval + outcome-weighted ranker — _"as good as a human SDR at retrieving and showing the right content for a buyer's question."_

**Status:** Phase 1 in progress — building the Organisation Brain + Intelligence Layer headless. Voice wrapper comes in Phase 2.

## Architecture in one paragraph

A single Postgres instance (Neon, with pgvector + tsvector) at launch carries vectors, BM25 keyword index, the typed-edge knowledge graph, outcome-weight tables, and Knowledge Object metadata. The Retrieval Intelligence Engine runs hybrid search (vector + BM25 + RRF + reranker) over candidates from graph traversal + conversation memory, weighted by seven scoring inputs tuned per tenant by the Outcome Reinforcement Engine. Ingestion is regex-first (typed edges with zero LLM calls) with Claude reserved for ambiguous semantic edges and Knowledge Object classification. Orchestration is in-house — a single Claude streaming call per turn, no multi-agent framework. Neo4j, Qdrant, and Graphiti are deferred behind explicit triggers; markdown is the system of record, Postgres is the derived index.

## Start here

1. **`KICKOFF.md`** — Phase 1 build brief. Read this before anything else. Locks the architectural decisions, scopes Phase 1, sequences the eight weeks, and defines the exit criteria.
2. **`docs/AI_Sales_Agent_PRD_v3.6.docx`** — full PRD (source of truth).
3. **`docs/TechNote.md`** — the tight summary version.
4. **`docs/adr/`** — Architecture Decision Records for the consequential locks.

## For Claude Code

Start every session with:

> _Read `KICKOFF.md`, then the PRD and `docs/TechNote.md`, then do \<task\>. Operating rules and architectural locks in `KICKOFF.md` are non-negotiable; surface deviations as ADRs before merging._

The eight-week build order and definition of done are in `KICKOFF.md` § Build order and § Definition of Done.

## Phase 1 acceptance gates

- Asset Precision@1 ≥ 70%, P@3 ≥ 90%, Human-AE Benchmark ≥ 75%, Coverage ≥ 80%
- Graph-on-vs-off shows ≥ 5pt P@5 improvement
- Text-mode retrieval p95 latency < 500ms
- Multi-tenant isolation verified by automated test

Until all four are met on a real pilot customer's content, Phase 2 does not start.

## License

Proprietary. © Allyvate.
