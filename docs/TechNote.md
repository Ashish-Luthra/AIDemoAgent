# Tech Note: AI Sales Demo

_29 May 2026 · aligned to PRD v3.6 (reconciled)_

## Ingestion layer

**Sources (full footprint):**

- **Website** — crawler (Playwright or managed crawl) → pages, blog, case studies, docs
- **Confluence** — via MCP; preserves internal page-link structure
- **CRM (HubSpot / Salesforce)** — via MCP, bidirectional (read for ingestion, write post-call)
- **Google Drive** — via MCP; the 50–75 PPTs + docs

**Processing pipeline:**

- **File-type router** — branches by source/type
- **LlamaParse** (or equivalent) — document + PPT extraction
- **OpenAI Whisper** — audio/video transcription (call recordings, if present)
- **Regex inference cascade [new]** — typed graph edges from wikilinks/structure with **zero LLM calls** (USES, INTEGRATES_WITH, FOR_PERSONA); handles the bulk of obvious edges cheaply — pattern borrowed from GBrain, edge types per Allyvate's sales-content domain
- **Claude Sonnet classifier** — reserved for the harder work: typed Knowledge Object classification, **entity resolution** (merging "Match Booster" / "identity resolution" / "MatchBooster™" into one canonical node), and ambiguous/semantic edges the regex pass can't type
- **Embeddings** — OpenAI text embeddings + CLIP-style image embeddings
- **Index construction** — writes vectors + typed edges into Postgres (see storage)
- **Thumbnail rendering** — asset display + Creative Studio

## Storage / the Brain

**The launch posture is one Postgres instance doing most of the work** — GBrain's production deployment (146K pages, 24K people on Postgres+pgvector with typed edges, no Neo4j) is the evidence this scales past a single Allyvate tenant's full footprint.

- **Postgres (Neon) [launch]** — does five jobs at once:
  - **pgvector** — vector index for semantic candidate generation
  - **Full-text search (BM25-style)** — keyword arm of hybrid retrieval
  - **Relationship graph** — typed-edge tables + recursive CTEs for multi-hop traversal (the graph layer is critical — GBrain's +31.4-pt P@5 lift proves it — but it lives here at launch, not in a separate DB)
  - **Outcome-weight tables** — the ranker's learned memory
  - **Knowledge Object metadata + episodic/account conversation memory**
- **Redis (ElastiCache) [launch]** — live session memory + BullMQ queue
- **S3 + CloudFront [launch]** — raw vault, compiled Brand Books (markdown = system of record), thumbnails, images
- **Neo4j AuraDB [trigger: real-time multi-hop p95 breaches 590ms under concurrent load]** — graduate the relationship graph here only when Postgres traversal latency fails the live-voice budget. Capacity isn't the trigger (Postgres holds it); real-time traversal speed is.
- **Qdrant [trigger: ~1M vectors total OR metadata-filtering needs]** — graduate the vector arm here when pgvector tuning gets real
- **Graphiti [trigger: stale-fact errors measurable]** — temporal validity on the graph; justified later because website + Confluence sync continuously
- **Edge inference [scales horizontally, not architecturally]** — ingestion volume scales by adding BullMQ workers, not by changing stores; trigger is throughput, no graduation

**Operating discipline (from GBrain):** markdown is the system of record, the index is derived. The Brand Book + compiled Knowledge Objects live as human-editable, git-versioned markdown; the Postgres index (vectors + edges + metadata) is rebuildable from it. Humans edit markdown directly; a sync job re-indexes.

## Intelligence layer

- **Retrieval Intelligence Engine** — three stages:
  - **Stage 1 — Candidate generation [updated]:** hybrid search — vector (pgvector) + keyword (BM25/FTS) + Reciprocal Rank Fusion + reranker (Cohere Rerank / ZeroEntropy / cross-encoder), plus graph traversal and conversation memory. Pure vector is out — BM25 catches exact product names and phrasings vectors blur.
  - **Stage 2 — Weighted scoring:** seven weighted inputs — 0.30 relevance (hybrid) · 0.20 persona · 0.15 objection · 0.15 historical success · 0.10 opportunity stage · 0.05 freshness · 0.05 approval; v1 heuristics, tuned per tenant by the Outcome Reinforcement Engine.
  - **Stage 3 — Selection:** top artifact + confidence + reasoning trace + ranked alternatives (fallback chain).
- **Outcome Reinforcement Engine** — reward/penalty signals, EWMA weight updates, decay, ε-greedy exploration; tunes the ranker per tenant
- **Creative Intelligence Engine** — same three-stage pattern, creative-specific weights (channel, audience, objective, brand-voice match)
- **Brand Book** — compiled per-tenant markdown "constitution" (voice, banned words, compliance, positioning); small enough to load into context
- **Overnight consolidation cron [new]** — scheduled BullMQ jobs run entity-resolution passes, Outcome Reinforcement updates, citation/provenance fixes, and staleness checks off the hot path (GBrain's "runs while you sleep" pattern)

## Models / AI APIs

- **Claude Sonnet** — ingestion classifier, runtime turn brain, creative generator
- **Deepgram Nova-3** — STT (real-time, WSS, VAD)
- **Mistral Voxtral** — TTS primary
- **ElevenLabs Flash v2.5** — TTS fallback
- **OpenAI** — Whisper (batch transcription) + text embeddings
- **CLIP-style model** — image embeddings (Creative Studio visual similarity)
- **Reranker [new]** — Cohere Rerank / ZeroEntropy / self-hosted cross-encoder for hybrid-search precision
- **HeyGen / Tavus** — video avatar + lip-sync

## Connectors (MCP)

- **HubSpot MCP, Salesforce MCP [launch]** — CRM read + writeback
- **Confluence MCP, Google Drive MCP [launch]** — ingestion sources
- **Slack / Gmail MCP [later]** — tribal-knowledge capture
- **Meta / LinkedIn MCP [later — Creative Studio]** — campaign performance feedback into the ranker

## Compute / application

- **ECS Fargate** — four task families: Runtime API, Ingestion API, Onboarding API, Async Workers
- **In-house turn orchestrator** — single Claude streaming call per turn (classify + MEDDIC + retrieval plan + steering + nudge + response generation in one call); no multi-agent framework (LangChain / LangGraph explicitly ruled out)
- **Fastify (Node.js)** — API framework
- **BullMQ** — async job queue on Redis (ingestion + overnight consolidation)
- **Next.js 16** — frontend for both products
- **Creative Studio** — TypeScript, Fabric.js (canvas), Zustand (state), MJML (email compile), HTML/CSS export

## Network / AWS

- **VPC us-east-1, multi-AZ** — public / private / database subnets
- **ALB** — TLS termination, WebSocket upgrade (`idle_timeout` ≥ 4000s for long demos)
- **NAT gateway** — Elastic IPs documented for HubSpot/Salesforce/Confluence vendor whitelisting
- **CloudFront + Route 53 + WAF** — edge, DNS, protection

## Platform / cross-cutting

- **Clerk + Google OAuth** — auth, sessions, multi-tenant isolation (the boundary GBrain explicitly doesn't provide — we own it)
- **AWS Secrets Manager + KMS** — secrets, per-tenant keys, AES-256 at rest, TLS 1.3 in transit
- **Pino → CloudWatch + DataDog + OpenTelemetry** — logs, metrics, distributed tracing, per-tenant dashboards
- **GitHub Actions + SST or Terraform + Turborepo** — CI/CD, IaC, monorepo
- **Policy layer, provenance/approval lifecycle, eval framework** — including retrieval metrics (Precision@1/@3, Human AE Benchmark, Coverage Score) and a **graph-on/graph-off P@5 check** to keep validating the graph layer's contribution

## Explicitly ruled out (as engines)

- **GBrain** — single-operator design; multi-tenant SaaS isolation is a structural mismatch + v0.38 maturity. Studied as reference implementation; patterns borrowed (regex edges, hybrid search, markdown-as-record, overnight cron)
- **LangChain / LangGraph** — orchestration framework not needed; turn loop is one Claude streaming call behind an in-house state machine and provider abstractions
- **Byterover** — coding-agent focused, source-available restrictions
- **OpenViking** — AGPLv3 + ByteDance origin
- **Pure vector RAG** — fails SDR-quality multi-hop; also misses exact phrases (hence hybrid)
- **Pure long-context / Karpathy wiki as core** — corpus doesn't fit context; survives only as the Brand Book layer

## Launch-critical core, one line

A single **Postgres** doing vectors (pgvector) + keyword (BM25) + typed-edge graph + outcome weights + memory, behind the **Retrieval Intelligence Engine** with **hybrid search (vector + BM25 + RRF + reranker)**, fed by four MCP/crawl sources through a **regex-first + Claude-for-ambiguous** ingestion pass, orchestrated by a **single Claude streaming call per turn** (no multi-agent framework), with **Claude + Deepgram + Voxtral** running the live agent — and **Neo4j + Qdrant + Graphiti** all sitting behind defined triggers, not built day one.

## What changed from the previous version, explicitly

1. **Neo4j: "critical, build now" → latency-triggered graduation.** GBrain's production scale on Postgres-graph removed the capacity argument; only real-time traversal latency justifies the move now.
2. **Pure pgvector → hybrid search** (vector + BM25 + RRF + reranker) in the RIE.
3. **Claude-classifies-everything → regex-first edges, Claude for the ambiguous remainder** — meaningful ingestion-cost reduction at full-footprint volume.
4. **LangChain / LangGraph → in-house turn orchestrator** — single Claude streaming call per turn, no multi-agent framework.
5. Added **markdown-as-system-of-record** discipline and the **overnight consolidation cron**.
