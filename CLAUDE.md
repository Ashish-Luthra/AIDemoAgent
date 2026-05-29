# CLAUDE.md — Allyvate Brain

Start every session by reading **`KICKOFF.md`**, then `docs/AI_Sales_Agent_PRD_v3.6.docx` and
`docs/TechNote.md`. Those are the source of truth; this file is a pointer to the non-negotiables.

## Architectural locks (do not deviate without an ADR in `docs/adr/`)

1. **Storage = one Postgres (Neon).** pgvector + tsvector/pg_trgm + typed-edge tables + outcome
   weights + KO metadata. No Neo4j / Qdrant / Pinecone / Weaviate / Graphiti — deferred behind
   numeric triggers (ADR 0001, PRD §16).
2. **Retrieval = hybrid.** vector + BM25 + RRF + reranker (Cohere, abstracted). Pure vector RAG is out.
3. **Edge inference = regex-first, Claude for the ambiguous remainder.** Never call Claude for what a
   regex can type.
4. **Orchestration = in-house, single Claude streaming call per turn.** No LangChain / LangGraph /
   multi-agent framework (ADR 0002).
5. **Markdown is the system of record; Postgres is a derived index.**
6. **Multi-tenant by default.** Every domain table has `tenant_id` + an RLS policy. The guard in
   `packages/db/src/__tests__/schema-invariants.test.ts` fails CI otherwise.
7. **Provider abstractions are mandatory** — see `packages/shared/src/providers`.

## Layout

- `apps/brain-api` — Fastify (ingestion + retrieval endpoints)
- `apps/brain-ui` — Next.js 16 single-page Brain tester
- `packages/{shared,db,ingestion,retrieval,brand-book,mcp-clients,eval}`
- `infra` — SST v3 stacks (stub in Week 1)

## Commands

```bash
pnpm install          # bootstrap
pnpm typecheck        # tsc --noEmit across the monorepo
pnpm test             # vitest across all packages
pnpm lint             # eslint
pnpm db:generate      # drizzle-kit generate (needs DATABASE_URL)
pnpm db:migrate       # apply migrations (creates pgvector + pg_trgm extensions)
pnpm db:seed          # seed one pilot tenant
```

## Conventions

- Every Claude call → structured output validated by a Zod schema. No free-form parsing.
- Every external API call → typed wrapper with retry + circuit breaker + structured logs.
- Every package ships Vitest unit tests; pipeline integration tests live in `packages/eval`.
- New npm dependency → one-line justification in the PR description.
- Migrations touching `tenants`/`nodes`/`edges`/`knowledge_objects`/`outcome_weights` → surface for review.
