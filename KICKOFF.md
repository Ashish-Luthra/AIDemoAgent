# Allyvate Brain — Phase 1 Kickoff (for Claude Code)

Read this file first. Then read `docs/AI_Sales_Agent_PRD_v3.6.docx` and `docs/TechNote.md`. Then start.

---

## Mission

You are building the **Organisation Brain + Intelligence Layer** for Allyvate — a B2B SaaS company shipping an AI sales demo agent and a creative studio on top of a shared knowledge substrate ("one Brand Brain, two interfaces"). Phase 1 builds the Brain **headless**: full ingestion, full retrieval quality, no voice, no real-time pipeline. Voice is a wrapper that comes in Phase 2 and is the easy part. The Brain is the moat and the risk.

The North Star: _retrieval is as good as a human SDR at finding the right asset for a buyer's question_. That is a measurable retrieval-quality bar (§13.4 of the PRD), not a voice bar. We hit it in Phase 1 or we have nothing.

---

## Architectural locks — do not deviate without an ADR

1. **Storage at launch = one Postgres instance.** Postgres (Neon) does five jobs: pgvector for vectors, full-text search for the BM25 arm, typed-edge tables + recursive CTEs for the graph, outcome-weight tables for the ranker memory, Knowledge Object metadata + episodic/account memory. Do not add Neo4j, Qdrant, Pinecone, Weaviate, Graphiti, or any other store. These are explicitly deferred behind triggers in PRD §16.
2. **Retrieval = hybrid search.** Vector (pgvector) + keyword (BM25 via tsvector/pg_trgm) + Reciprocal Rank Fusion + reranker (Cohere Rerank by default, provider-abstracted). Pure vector RAG is explicitly ruled out.
3. **Edge inference = regex-first, Claude for the ambiguous remainder.** Deterministic regex cascade types the obvious edges (USES, INTEGRATES_WITH, FOR_PERSONA) with zero LLM calls. Claude is reserved for typed Knowledge Object classification, cross-source entity resolution, and ambiguous semantic edges only. Do not call Claude for things regex can handle.
4. **Orchestration = in-house, single Claude streaming call per turn.** No LangChain. No LangGraph. No multi-agent frameworks. The runtime is an in-house state machine + provider abstractions; per-turn reasoning is one streaming call.
5. **Markdown is the system of record. Postgres is a derived index.** Brand Books and compiled Knowledge Objects live as human-editable, git-versioned markdown. The index is rebuildable from markdown. Humans edit markdown; a sync job re-indexes.
6. **Multi-tenant by default.** Every domain table has `tenant_id`. Every query filters on it. Row-Level Security policies on by default. Tenant isolation is the architectural boundary GBrain doesn't provide and we own.
7. **Provider abstractions are mandatory** for: LLM (Claude), text embeddings (OpenAI), image embeddings (CLIP-style), reranker (Cohere), document extraction (LlamaParse), batch transcription (Whisper). Each lives behind a typed interface in `packages/shared`. STT/TTS interfaces are stubbed but not implemented in Phase 1.

---

## Phase 1 scope (what to build)

**Ingestion sources, all four, full footprint:**

- Website — Playwright crawler
- Confluence — via MCP
- CRM (HubSpot + Salesforce) — via MCP, **read-only** this phase
- Google Drive — via MCP

**Ingestion pipeline:**

- File-type router → LlamaParse (docs/PPTs) + Whisper (audio/video)
- Regex inference cascade — typed edges from structure/wikilinks, zero LLM
- Claude classifier — typed Knowledge Object classification + entity resolution + ambiguous edges
- Embeddings — OpenAI text + CLIP-style image
- Index construction — writes vectors + typed edges + KO metadata to Postgres
- Thumbnail rendering

**Knowledge graph:**

- Node types: Asset, Concept, Persona, ObjectionType, plus KO subtypes
- Edge types: USES, INTEGRATES_WITH, FOR_PERSONA, ADDRESSES, RELEVANT_FOR, COUNTERED_BY, and outcome-weighted edges
- Provenance backpointers on every node and edge

**Knowledge Object model** (typed business objects, not generic text chunks):
ObjectionHandler · PricingClaim · ROIStory · CaseStudy · ImplementationPath · SecurityResponse · CompetitorCounter · FeatureExplanation

**Brand Book layer** — per-tenant compiled markdown constitution (voice, banned words, compliance, positioning). Loaded into Claude's context for classification and retrieval-time policy.

**Retrieval Intelligence Engine (3 stages):**

- Stage 1 — Candidate generation: hybrid search (vector + BM25 + RRF + reranker) + graph traversal + conversation memory → ~20 candidates
- Stage 2 — Weighted scoring with seven inputs: 0.30 relevance (hybrid) · 0.20 persona · 0.15 objection · 0.15 historical success · 0.10 opportunity stage · 0.05 freshness · 0.05 approval
- Stage 3 — Selection: top artifact + confidence + reasoning trace + ranked alternatives

**Outcome Reinforcement Engine:**

- Reward/penalty signals from session events
- EWMA weight updates, ~5%/qtr decay, ε-greedy at ~10%, negative reinforcement on consistent misses
- Tenant-scoped; cross-tenant only via anonymized Layer 4 patterns

**Overnight consolidation cron** (BullMQ scheduled job):

- Entity-resolution passes
- Outcome Reinforcement weight updates
- Citation / provenance integrity checks
- Staleness checks

**Eval harness** (this is how we know Phase 1 is done):

- Offline scenario suite — labeled (question, expected artifact) pairs
- Metrics: Asset Precision@1 ≥ 70%, P@3 ≥ 90%, Human-AE Benchmark ≥ 75%, Coverage ≥ 80%
- Graph-on vs graph-off precision check — the graph layer must measurably contribute

**Minimal Brain UI** (Next.js 16, single page) — type a question, see top artifact + confidence + reasoning trace + alternatives + provenance. No voice. No avatar.

---

## Explicitly OUT of Phase 1

- Deepgram, Voxtral, ElevenLabs, HeyGen, Tavus — all voice/avatar stack is Phase 2
- Real-time pipeline, barge-in, ALB WSS, audio interrupt controller — Phase 2
- Coverage tracker, Persona Resolver, MEDDIC capture, steering moves, agent-led close — Phase 3 (these sit on top of the Brain)
- CRM writeback (read only in Phase 1) — Phase 4
- Onboarding UI polish — Phase 4
- Creative Studio interface — separate later phase (the Brain it uses is the same one)
- Neo4j, Qdrant, Graphiti — behind triggers in §16, do not build

---

## Tech stack (locked)

- **Runtime:** Node.js 22+, TypeScript 5+
- **API:** Fastify
- **DB:** Postgres 16 (Neon) + Drizzle ORM + pgvector + tsvector/pg_trgm
- **Queue:** BullMQ on Redis (ElastiCache in prod)
- **LLM:** Anthropic Claude Sonnet (latest), streaming
- **Embeddings:** OpenAI `text-embedding-3-large` (text); CLIP-style (images)
- **Reranker:** Cohere Rerank (provider-abstracted)
- **Document extraction:** LlamaParse
- **Batch transcription:** OpenAI Whisper / GPT-4o Mini Transcribe
- **Frontend:** Next.js 16, Tailwind 4, Zustand (state)
- **Validation:** Zod everywhere — every Claude structured output, every API boundary
- **Tests:** Vitest
- **Monorepo:** Turborepo
- **CI/CD:** GitHub Actions
- **IaC:** SST v3
- **Auth:** Clerk + Google OAuth (multi-tenant boundary)
- **Secrets:** AWS Secrets Manager + KMS
- **Observability:** Pino → CloudWatch + DataDog + OpenTelemetry

---

## Repo layout

```
apps/
  brain-api/         Fastify: ingestion + retrieval HTTP/WS endpoints
  brain-ui/          Next.js 16: text chat UI for Brain testing
packages/
  db/                Drizzle schema, migrations, seed scripts
  ingestion/         File-type router, parsers, regex cascade, Claude classifier
  retrieval/         RIE (hybrid search, graph, scoring), ORE
  brand-book/        Markdown loader + compiler
  mcp-clients/       HubSpot, Salesforce, Confluence, Google Drive wrappers
  eval/              Offline harness, scenario suite, metrics
  shared/            Types, Zod schemas, provider interfaces, constants
infra/               SST stacks
docs/                PRD, tech note, ADRs
```

---

## Build order — 8 weeks

**Week 1 — Bootstrap + schema**
Turborepo init. Package skeleton. Drizzle schema for: `tenants`, `nodes`, `edges`, `knowledge_objects`, `embeddings` (pgvector), `outcome_weights`, `brand_books`, `ingestion_runs`, `provenance`. Migrations. Seed scripts. `.env.example`, AWS Secrets Manager loading. GitHub Actions: lint + typecheck + test on PR.

**Week 2 — Ingestion: extract + classify**
LlamaParse adapter. Whisper batch adapter. Regex edge inference (deterministic, configurable rules in `ingestion/rules/`). Claude classifier with Zod-validated structured output. Entity resolution (cross-source canonical-node merge).

**Week 3 — Ingestion: indexing + sources**
Embedding writer (text + image). Graph build (typed edges → Postgres). MCP connector wrappers (HubSpot, Salesforce, Confluence, GDrive — read paths only). Playwright website crawler. BullMQ worker pipeline with retry + circuit breakers.

**Week 4 — Retrieval Intelligence Engine**
pgvector ANN query. BM25/FTS keyword query. RRF fusion. Cohere Rerank integration. Graph traversal via recursive CTEs. Conversation memory stub (session-only). Seven-input weighted scoring. Output contract: `{top_artifact_id, confidence, reasoning_trace, alternatives}`.

**Week 5 — Outcome Reinforcement + overnight cron**
Reward/penalty signal capture. EWMA edge-weight updates. Decay job. ε-greedy exploration. Overnight consolidation BullMQ job (entity resolution, weight updates, citation/staleness checks).

**Week 6 — Eval harness + Brain UI**
Offline scenario suite. P@1, P@3, Human-AE-Benchmark, Coverage. **Graph-on-vs-graph-off** precision check. Brain UI: single Next.js page — type a question, see top artifact + confidence + reasoning trace + alternatives + provenance popover.

**Week 7 — Brand Book + polish**
Per-tenant markdown loader. Context injection into classifier + retrieval. Multi-tenant isolation tests (RLS verified). Pilot onboarding script.

**Week 8 — Pilot dry run**
Ingest one design partner's full footprint (Drive + website + Confluence). Run eval harness. Iterate on regex rules and ranker weights until acceptance bars are met.

---

## Phase 1 — Definition of Done

- Pilot design partner's full footprint ingested (4 sources, ~1k+ chunks, ~10k+ edges)
- Eval harness passing: P@1 ≥ 70%, P@3 ≥ 90%, Human-AE ≥ 75%, Coverage ≥ 80%
- Graph-on-vs-graph-off shows ≥ 5pt P@5 improvement from the graph layer
- Text-mode retrieval latency: p95 < 500ms
- Multi-tenant isolation verified by automated test (cross-tenant query attempt → blocked)
- One eval scenario per Knowledge Object subtype in the regression suite

If any bar is not met, do not advance to Phase 2. Iterate on regex rules, ranker weights, Brand Book, or graph schema until met.

---

## Operating rules (for Claude Code itself)

- Read the PRD and TechNote before starting any new package. They are the source of truth — this file is the summary.
- Every architectural deviation requires an ADR in `docs/adr/NNNN-short-name.md` before merging.
- Every new npm dependency requires a one-line justification in the PR description.
- Every Claude call uses structured output with a Zod schema. No free-form parsing.
- Every external API call goes through a typed wrapper with retry + circuit breaker + structured logs.
- Provider abstractions are non-negotiable — see Architecture Lock #7.
- Every package ships with Vitest unit tests. Pipeline integration tests live in `packages/eval`.
- Every domain table has `tenant_id` and an RLS policy. CI fails if a table lacks either.
- Never call Claude for something a regex can handle. Never add a vector DB other than pgvector. Never add an orchestration framework.

---

## When to stop and ask

- A vendor decision not in the PRD is about to get locked (e.g. choosing between two MCP gateway providers, two image embedding models).
- An inconsistency surfaces between the PRD, this Kickoff, and reality.
- A piece of infrastructure starts to feel like it belongs in Phase 2+ (voice, real-time, MEDDIC, etc.).
- A dependency would do something a single Claude call could do.
- A migration touches `tenants`, `nodes`, `edges`, `knowledge_objects`, or `outcome_weights` — these are the spine; surface for review.

---

## First concrete step

Initialize the Turborepo. Set up `package.json`, `tsconfig.base.json`, `turbo.json`. Scaffold all package directories per the layout above. Write the initial Drizzle schema covering the nine tables in Week 1. Open a PR titled `chore(bootstrap): scaffold repo + initial Drizzle schema`. Tag it `phase-1/week-1`.

End of brief.
