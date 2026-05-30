# 0003 — Provision the Neon dev branch in Week 3; eval harness measures on Neon from Week 6

**Status:** Accepted · 30 May 2026
**Phase:** 1

## Context

ADR 0001 locked **Neon** as the single launch Postgres but did not pin _when_ a Neon environment first comes online. The original build order stood up Neon late — around pilot onboarding / deploy (Week 7–8) — and ran all earlier development against a local Postgres.

That ordering has a measurement gap. Phase 1's Definition of Done includes a hard latency bar — **text-mode retrieval p95 < 500 ms** — and the Week 6 eval harness ships a **graph-on / graph-off P@5 check** plus the precision/coverage gates. Those numbers are only trustworthy on the substrate we actually launch on. Local Postgres on a developer machine has no network round-trip, no serverless cold-start, no connection-pooler hop, and different IO characteristics than Neon. Measuring latency locally in Week 6 and discovering the real Neon profile only at pilot (Week 8) risks failing the p95 gate after the eval harness has already "passed" — exactly the wrong time to learn it, and the trigger in ADR 0001 (graph → Neo4j at p95 > 590 ms) is keyed to real numbers.

## Decision

**Provision a Neon project with a dedicated dev branch by the end of Week 3.** From Week 6, the eval harness runs retrieval against Neon (via `DATABASE_URL`) and records latency, so P@k, coverage, the graph-on/off delta, **and p95 latency** are all measured on the launch substrate.

- **Local Postgres remains the default for day-to-day dev and unit/integration tests.** Neon is the perf-and-eval target, not a hard dependency for every test run.
- **CI keeps using the ephemeral `pgvector/pgvector:pg16` container** (ADR-adjacent, see CI workflow) for correctness; Neon is for representative _performance_, not correctness gating in CI.
- **Connection discipline:** migrations and seeds use Neon's **direct (unpooled)** endpoint; the runtime/eval path uses the **pooled** endpoint. `createDb` auto-disables prepared statements on a pooled URL (PgBouncer transaction mode); `isPooledConnection` encodes the rule. SSL is taken from the URL (`sslmode=require`).
- Neon's branch-per-environment model means the dev branch is cheap and disposable — it can be reset/recreated without touching a future pilot or prod branch.

## Consequences

**Good:**

- The Week 6 eval harness reports p95 latency on the real substrate, so the < 500 ms DoD bar and the 590 ms graph-graduation trigger are evaluated against truth, not a local proxy.
- Pooler/SSL/prepared-statement gotchas surface in Week 3, not during a pilot.
- A standing Neon dev branch is available for any earlier perf spot-checks (e.g. pgvector HNSW tuning).

**Costs / risks:**

- A Neon account + connection string must exist by end of Week 3 (owner action; provisioning needs the account holder).
- Two Postgres targets in play (local + Neon) — mitigated by `DATABASE_URL` being the only switch and CI staying on the container.
- Neon free-tier limits (compute hours, branch count) need a glance if eval runs get heavy; upgrade is a billing decision, not an architecture one.

## References

- ADR 0001 — Postgres-first storage (Neon as the launch store)
- KICKOFF — Definition of Done (p95 < 500 ms; graph-on/off P@5 check, Week 6)
- `packages/db/src/client.ts` — `isPooledConnection`, pooled-endpoint prepared-statement handling
