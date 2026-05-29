# 0002 — In-house turn orchestrator; LangChain and LangGraph ruled out

**Status:** Accepted · 28 May 2026
**Phase:** 1

## Context

Earlier PRD versions listed LangChain + LangGraph as the orchestration layer. As the runtime design matured, every per-turn capability — utterance classification, MEDDIC accumulator update, retrieval planning, steering decision, nudge decision, response generation — collapsed into structured outputs from a single Claude streaming call (PRD §8.4, §8.5, §10.1). The orchestration framework was carrying nothing.

Two further considerations:

1. **Latency budget.** First-audio target is ~590ms. Every framework hop between user speech and Claude's first token is a tax. A single streaming call with structured outputs is the shortest possible path.
2. **Eval surface.** One prompt + one schema + one output = one thing to grade. Multi-agent decomposition multiplies the surface area of "did the right thing happen?" without earning that complexity for v1.

The architecture explicitly _reserves_ a decomposition path (PRD §15.2 — Conversation Agent, Retrieval Agent, Sales Coach Agent, CRM Agent, Policy Agent) for the future. It is documented so prompts and schemas evolve cleanly; it is not built.

## Decision

Per-turn reasoning is **a single Claude streaming call** that produces a structured output covering classification, MEDDIC update, retrieval strategy, coverage update, response generation, and optional appendages (steering move, MEDDIC nudge, close offer).

Orchestration outside that call is **in-house**:

- A session state machine (`IDLE → OPENING → LISTENING → PROCESSING → ANSWERING`, plus `DUCKED`, `INTERRUPTED`, `ENDED`)
- Typed provider abstractions for LLM, STT, TTS, embeddings, reranker, MCP gateway, CRM
- BullMQ for ingestion and overnight consolidation jobs

No LangChain. No LangGraph. No multi-agent framework. No agent-runtime SDK.

## Consequences

**Good:**

- One streaming network call per turn; minimum possible latency floor.
- Prompt changes are atomic — no orchestration logic to keep in sync.
- One eval surface; one Zod schema graded end-to-end.
- Provider abstractions are ours, so swapping a vendor (e.g. reranker, image embedder) is a one-file change in `packages/shared`.

**Costs / risks:**

- We own the state machine, retry semantics, circuit breakers, and observability ourselves. They have to be built and tested rather than inherited from a framework.
- Future decomposition (PRD §15.2) requires deliberate work — it does not happen incrementally.
- If a teammate reaches for LangChain "just for this one thing," the ADR has to be revisited rather than worked around.

**What this rules out for Phase 1:**

- LangChain, LangGraph, LlamaIndex (as orchestrator — LlamaParse for document extraction is fine), Haystack, Semantic Kernel, AutoGen, CrewAI, or any other multi-agent framework.
- Splitting per-turn reasoning across multiple LLM calls without an ADR amending this one.

## References

- PRD v3.6 §8.4 The Turn Loop, §8.5 Decision Hierarchy, §10.1 Note on the brain, §15.2 Multi-Agent Decomposition Path
