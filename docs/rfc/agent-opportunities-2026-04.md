# Agent-Opportunities Report — Resonate

**Date:** 2026-04-22
**Author:** @akoita (research-assisted)
**Status:** Discussion / proposal

Research pulled from four parallel tracks: **codebase inventory**, **docs/RFCs**, **issue backlog (318 issues / 45 PRs mined)**, and **Q1/Q2-2026 ecosystem survey** (primary sources). Below is the synthesis, then ranked opportunities, then a staged roadmap.

---

## 1. Where the project stands today

Resonate is not a green field — it is roughly **55% agent-complete** with a clear thesis and good substrate. The gap isn't "do we have an agent?" — it's "which of the 2026 trend-setting primitives are missing from a stack that's already ambitious?"

**What's shipped** (high confidence, verified against code):

- **Agent runtime** — Google ADK (`@google/adk`) + Vertex/Gemini fallback, deterministic orchestrator as last line of defense ([backend/src/modules/agents/agent_runtime.service.ts](../../backend/src/modules/agents/agent_runtime.service.ts), [runtime/adk_adapter.ts](../../backend/src/modules/agents/runtime/adk_adapter.ts)).
- **Three-role orchestration** — Selector / Mixer / Negotiator services, each with its own seam.
- **Tool registry** — `catalog.search`, `pricing.quote`, `analytics.signal` (mocked), `embeddings.similarity`, `generation.create`, `generation.complementary` ([tools/tool_registry.ts](../../backend/src/modules/agents/tools/tool_registry.ts)).
- **Agent wallet** — self-custodial ECDSA keypair, AES-256-GCM at rest (or GCP KMS), ZeroDev Kernel v3 smart account + session keys, USDC budget enforcement ([agent_wallet.service.ts](../../backend/src/modules/agents/agent_wallet.service.ts), [agent_purchase.service.ts](../../backend/src/modules/agents/agent_purchase.service.ts)).
- **Lyria generation** — `@google/genai` live-music, SynthID watermark verification, BullMQ queue, $0.06 per 30s clip.
- **x402 paywall** — middleware + `/api/stems/:id/x402` + `x-payment-info` in OpenAPI (PR #403, #533).
- **AgentCash machine-first pivot** — `/openapi.json`, `/.well-known/x402`, USDC-canonical pricing, structured receipts (epic #499, mostly closed).
- **Dashboard UI** — setup wizard, status card, budget ring, taste card, activity feed, history ([web/src/app/agent/page.tsx](../../web/src/app/agent/page.tsx), [web/src/components/agent/](../../web/src/components/agent/)).

**What's planned but unshipped** (from docs + backlog):

- **ERC-8004 identity + reputation** — referenced in [RESONATE_SPECS.md](RESONATE_SPECS.md), [agentic_ai_orchestration.md](../account-abstraction/agentic_ai_orchestration.md), backlog #261, #291, #322. Code has a comment "Prep for ERC-8004 identity" at [AgentTasteCard.tsx:263](../../web/src/components/agent/AgentTasteCard.tsx#L263).
- **Unified runtime extraction** — [RFC agent-platform-refactor.md](agent-platform-refactor.md) + backlog [#424](https://github.com/akoita/resonate/issues/424). "By extracting the agent into its own runtime with a clean API boundary, we naturally create the interface layer that ERC-8004 requires."
- **Curator Agents** — [#322](https://github.com/akoita/resonate/issues/322): "The AI DJ agent currently buys stems blindly — every buyer agent would need to independently analyze audio quality, which is redundant and wasteful."
- **Learning loop / real Taste Score** — [#290](https://github.com/akoita/resonate/issues/290): "The agent makes the same quality of decisions on day 100 as day 1."
- **Real-time remix engine** — [#323](https://github.com/akoita/resonate/issues/323): "`AgentMixerService.plan()` outputs a transition type string … but never touches audio."
- **LangGraph multi-agent state machine** — [#306](https://github.com/akoita/resonate/issues/306), explicitly parked by RFC until ADK proves insufficient.

**Blind spots the docs don't cover** (UI hints, no backing plan):

- MCP server exposure of Resonate's tools to *outside* agents.
- A2A (Agent-to-Agent) for Selector↔Mixer↔Negotiator as peers.
- Evaluation framework beyond the home-grown harness.
- Vector DB (issue #627 branch: pgvector-backed `EmbeddingStore` in backend).
- LLM observability / tracing.
- Agent memory layer (Mem0 / Letta / Zep).
- Claude or OpenAI in the stack at all — pure Google Gemini monoculture.

---

## 2. The 2026 trend map — what matters for senior-eng signal

Filtered from the landscape survey. In order of **CV-scarcity × genuine-production-use** in 2026:

| Primitive | Why it's hot in 2026 | Fit with Resonate |
|---|---|---|
| **MCP** (Model Context Protocol) | v1.0, Linux Foundation-adopted, 1,200-person Dev Summit NYC April 2026. The tool interop lingua franca. | **Very high** — Resonate is already an OpenAPI storefront; MCP is the adjacent surface. |
| **x402** + Coinbase AgentKit + Agentic.Market | 75M+ tx, Cloudflare + Stripe facilitators, agent-buyable APIs marketplace launched. | **Very high** — already shipped; expose to humans too + register in Agentic.Market. |
| **ERC-8004** | Mainnet Jan 2026, ~130k agents, v2 draft ties in MCP + x402. Scarce skill. | **Very high** — explicitly planned, unblocks curator-agent roadmap. |
| **Claude Agent SDK** | Weekly cadence, subagents/hooks/MCP first-class. TS-native. | **High** — hooks = clean way to enforce USDC budget; subagents = moderation/triage. |
| **Mastra** | TS-first, 1.0 Jan 2026, YC W25, 22k stars, Next.js-shaped. | **High** — natural for `web/` layer streaming UX and agent-side tool calls. |
| **LangGraph 1.0** | GA Oct 2025, LTS, Uber/LinkedIn/Klarna prod use. | **Medium** — only if the Selector/Mixer/Negotiator workflow outgrows ADK; parked by RFC. |
| **Langfuse** | OSS, OpenInference-compatible, most-adopted. | **High** — existing eval harness needs production telemetry. |
| **pgvector / Qdrant** | pgvector is the 2026 default under ~5M vectors; Qdrant for lowest p50 latency. | **High** — backend already has Postgres; `EmbeddingStore` now has a pgvector-backed path. |
| **Voyage 4 Large / Cohere embed-v4** | Beat text-embedding-3-large on MTEB by ~8–14%. | **Medium** — upgrade, not a rewrite. |
| **Mem0 + Letta** | Mem0 = plug-in memory; Letta = agent runtime with self-editing core/archival/recall. | **High** — direct answer to learning-loop issue #290. |
| **Demucs `htdemucs_ft` + ACE-Step v1.5 + AudioShake** | HTDemucs SDR 9.20 dB; ACE-Step = 4-min song in 20s OSS breakout 2026. | **Very high** — stems-native moat; directly unlocks issue #323. |
| **e2b / Modal sandboxes** | microVM/gVisor isolation for agent-run code. | **Medium** — only if you let the agent run DSP effects. |
| **Stagehand v3** | AI primitives on Playwright; the "hybrid" template for browser agents. | **Low/medium** — only for auto-promote/scrape features. |

**What's fading** — avoid these as visible dependencies:

- Raw LangChain (the agent layer; LangGraph is fine).
- Spleeter (3 dB SDR behind Demucs, deprecated 2022).
- Swarm (OpenAI's pre-Agents-SDK project).
- Suno/Udio scraper wrappers (Warner-Suno deal Jan 2026 signals crackdown).
- CrewAI for lean startups (fine in enterprise, opinionated for consumer).
- Riffusion, AutoGen (pre-AG2).

---

## 3. Opportunities — ranked by fit × trend × effort

Scored **1–5** where 5 = best. "Fit" = how natural to Resonate's goal, "Trend" = 2026 CV signal, "Effort" = smaller is better.

| # | Opportunity | Fit | Trend | Effort (lo=good) | Open issue |
|---|---|---|---|---|---|
| **1** | **Expose Resonate as an MCP server** (catalog/pricing/stem-download/generate as MCP tools; optional x402 gating via existing middleware) | 5 | 5 | 2 | *gap — no issue* |
| **2** | **Ship ERC-8004 Agent Identity + Reputation** — agent soulbound NFT, periodic taste/reputation attestations tied to `AgentConfig` | 5 | 5 | 3 | [#291](https://github.com/akoita/resonate/issues/291), [#261](https://github.com/akoita/resonate/issues/261) |
| **3** | **Curator agents publishing on-chain quality scores** via ERC-8004 Validation registry — fixes "buys stems blindly" problem | 5 | 5 | 3 | [#322](https://github.com/akoita/resonate/issues/322) |
| **4** | **Langfuse + rubric LLM-as-judge + golden set (start ~100, grow to 200)** — replace home-grown eval harness with the 2026 production pattern | 4 | 5 | 2 | *gap* |
| **5** | **Migrate `EmbeddingStore` → pgvector** (already Prisma/Postgres) — unblocks real taste similarity + learning loop | 5 | 4 | 2 | supports [#290](https://github.com/akoita/resonate/issues/290) |
| **6** | **Agent Learning Loop** — signal-weighted taste evolution, real Taste Score on dashboard; feeds into ERC-8004 attestation | 5 | 4 | 3 | [#290](https://github.com/akoita/resonate/issues/290) |
| **7** | **Unified agent runtime extraction** — single `AgentRuntimeService` entrypoint + `PaymentRouterService` (x402 ∥ ERC-4337) + `PolicyGuardService`; prerequisite to publishing the agent as its own MCP-ready process | 5 | 4 | 4 | [#424](https://github.com/akoita/resonate/issues/424), [RFC](agent-platform-refactor.md) |
| **8** | **Claude Agent SDK subagent for dispute triage** — classifier bot that comments on disputes, pre-tags evidence, suggests jury escalation; uses hooks to enforce evidence-quality thresholds | 4 | 5 | 3 | adjacent to [#408](https://github.com/akoita/resonate/issues/408), [#468](https://github.com/akoita/resonate/issues/468) |
| **9** | **Mastra for the `/create` + `/agent` streaming UX** — TS-native, Next.js-shaped, talks to the NestJS runtime via HTTP | 4 | 5 | 3 | — |
| **10** | **Real-time remix engine: Demucs `htdemucs_ft` + ACE-Step v1.5 melody-conditioned** — replaces `AgentMixerService.plan()` stub with actual audio | 5 | 5 | 5 | [#323](https://github.com/akoita/resonate/issues/323) |
| **11** | **Register Resonate in Agentic.Market / x402scan / mppscan** — machine-discovery for the DJ economy; already partially scoped | 5 | 5 | 2 | [#520](https://github.com/akoita/resonate/issues/520) |
| **12** | **Human-facing x402 checkout** — the rail is shipped for agents; surfacing it in the marketplace buy modal shows end-to-end ownership | 4 | 4 | 2 | *gap* |
| **13** | **Letta + Mem0 memory stack for the DJ** — core/archival/recall + short-term user session memory; depth-signal uncommon in 2026 portfolios | 4 | 4 | 3 | supports [#290](https://github.com/akoita/resonate/issues/290), [#307](https://github.com/akoita/resonate/issues/307) |
| **14** | **A2A (Agent-to-Agent) between Selector / Mixer / Negotiator** — turn the three-role orchestration into an A2A peer mesh; credible with the #424 extraction | 4 | 4 | 4 | extension of [#424](https://github.com/akoita/resonate/issues/424) |
| **15** | **Content-moderation agent: AcoustID + MusicBrainz + audio-embedding similarity** — the "Advanced Detection" plank of content protection | 4 | 4 | 4 | [#408](https://github.com/akoita/resonate/issues/408) |
| **16** | **Agent Personality Presets** (Bold Curator / Safe Selector / Budget Hawk / Genre Deep-Diver) with A/B eval | 3 | 3 | 2 | [#307](https://github.com/akoita/resonate/issues/307) |
| **17** | **Automated SynthID verify on ingestion** — flag misattributed AI content | 4 | 3 | 2 | [#347](https://github.com/akoita/resonate/issues/347) |
| **18** | **Stagehand v3 agent for "auto-promote on socials" / release-data scraping** | 2 | 4 | 3 | — |
| **19** | **Lyria on-chain generation provenance** (`{provider, prompt_hash, seed, synthid}` ERC-1155 ext) | 3 | 3 | 3 | [#349](https://github.com/akoita/resonate/issues/349) |
| **20** | **Ritual / EZKL proof-of-inference** — prove the DJ ran the claimed model; **speculative — demo, not path** | 2 | 5 | 5 | — |

**Opportunities 1, 2, 3, 10, and 11** are unusually good: fit the project's stated "machine-first audio protocol" thesis *and* score highest on 2026 trend signal.

---

## 4. Recommended roadmap — three waves

Each wave is designed to (a) close a UI/docs gap, (b) plant a high-signal tech flag, (c) set up the next wave.

### Wave 1 — Foundations + first high-signal ship (≈ 2–3 weeks)

Goal: three small, shippable PRs that each land a trend flag without a refactor.

1. **MCP server** (new module `backend/src/modules/mcp/`).
   - Expose 5 tools: `catalog.search`, `stem.quote`, `stem.buy_with_x402`, `stem.download`, `generate.track`.
   - Use the official `@modelcontextprotocol/sdk` TS SDK, streamable-HTTP transport.
   - Reuse the existing x402 middleware so paid tools are gated natively.
   - Public endpoint `/mcp` + `/.well-known/mcp.json`.
   - Outcome: Resonate is *discoverable by any MCP-aware agent* (Claude Code, Cursor, Claude Desktop). Senior-eng signal: you shipped an MCP server, not just consumed MCP servers.

2. **pgvector migration** — replace in-memory `EmbeddingStore` in [embeddings.similarity tool](../../backend/src/modules/agents/tools/tool_registry.ts) with pgvector-backed storage. The first slice keeps the current 16-dimensional local embedding shape in a `TrackEmbedding` table; provider-scale embeddings and HNSW indexing remain follow-ups. Directly improves the selector and is the only prerequisite to issue #290.

3. **Langfuse + golden-set eval** — add `@langfuse/node-sdk`, wrap ADK runner, start with ~100 curated golden cases under `backend/src/evals/` (queries like "deep house under $2", "upbeat pop with vocals") and grow toward 200 as coverage gaps appear, then add a GitHub Actions job that runs a judge-LLM rubric (genre match, budget respected, repeat avoidance). Retires the `AgentEvaluationService` internal metrics in favor of the industry-standard pattern.

### Wave 2 — Identity, reputation, and agent-as-a-brand (≈ 5–7 weeks)

Goal: ship the two most scarce on-chain primitives (ERC-8004 + curator attestations) and extract the agent runtime as its own publishable unit.

4. **ERC-8004 Agent Identity mint** (closes [#291](https://github.com/akoita/resonate/issues/291) / [#261](https://github.com/akoita/resonate/issues/261)).
   - Deploy or integrate the public ERC-8004 Identity Registry on Base.
   - On first agent activation, mint a soulbound NFT bound to the user's ERC-4337 smart account; metadata `{ agentId, vibes, monthlyCapUsd, createdAt }`.
   - Wire into [AgentSetupWizard](../../web/src/components/agent/AgentSetupWizard.tsx) after budget step.
   - Remove the "Prep for ERC-8004 identity" placeholder at [AgentTasteCard.tsx:263](../../web/src/components/agent/AgentTasteCard.tsx#L263).

5. **ERC-8004 Reputation attestations** — cron job publishes periodic attestations `{ tracksCurated, acceptanceRate, avgBudgetUtilization, genreBreakdown, tasteDepth }` from the learning loop.

6. **Curator Agent (Claude Agent SDK subagent)** — a *different* agent role that analyzes a stem's RMS energy, spectral density, silence ratio, musical salience and publishes 0–100 quality scores to ERC-8004's Validation registry. This is [#322](https://github.com/akoita/resonate/issues/322) — and it cleanly justifies bringing Anthropic into the stack alongside Google (multi-model fluency on a resume).

7. **Agent runtime extraction** ([#424](https://github.com/akoita/resonate/issues/424)) — extract `AgentRuntimeService` + `PaymentRouterService` + `PolicyGuardService` into a standalone NestJS app or Node service. Opens the door to public-agent composability and becomes the "binary" an outside ERC-8004-compatible agent talks to.

### Wave 3 — Remix engine + memory + human-facing x402 (≈ 6–10 weeks)

Goal: the creative moonshot.

8. **Real-time remix engine** ([#323](https://github.com/akoita/resonate/issues/323)) — `Demucs htdemucs_ft` for separation (already in workers/demucs), `ACE-Step v1.5` melody-conditioned for 20-sec remix continuations, optional `AudioShake` API for commercial-rights tracks. Replace `AgentMixerService.plan()` stub.

9. **Letta + Mem0 memory stack** ([#290](https://github.com/akoita/resonate/issues/290), [#307](https://github.com/akoita/resonate/issues/307)) — Letta's self-editing core/archival/recall for the *DJ's* profile (what it has learned about itself), Mem0 for the *user's* session/context memory. Real "Taste Score" derived from Letta's memory trajectory.

10. **Human-facing x402 buy flow** — add a "Pay with USDC (x402)" option to the stem buy modal; reuses existing middleware. Closes the UX gap where x402 is agent-only today.

11. **Register in Agentic.Market + x402scan** ([#520](https://github.com/akoita/resonate/issues/520)) — deploy the OpenAPI + MCP endpoints to a public host and submit.

---

## 5. What I would actually do next

If the goal is to turn this RFC into an execution plan rather than a broad opportunity map, the best next three bets are:

1. **MCP server**
   - Why first: highest trend signal, tightest fit with the machine-first thesis, and it compounds the x402/OpenAPI work that already exists instead of asking for a large architectural rewrite.
   - Why now: it is mostly additive and can ship without waiting on ERC-8004, curator agents, or runtime extraction.

2. **pgvector migration**
   - Why second: it is the least glamorous item in the report, but it is the cleanest dependency for real taste similarity, learning-loop quality, and curator-agent usefulness.
   - Why now: it reduces future rework. Building learning/reputation features on top of an in-memory embedding store would create throwaway logic.

3. **Langfuse + golden-set evals**
   - Why third: before adding more agent surface area, the team needs a real way to measure whether selector quality, budget behavior, and diversity actually improve.
   - Why now: it makes every later agent change easier to ship with confidence, including MCP, curator agents, and taste learning.

I would **not** start with ERC-8004 or the remix engine, even though they are stronger "headline" features. They are better as wave-two and wave-three moves after the platform has an external tool surface, a persistent retrieval substrate, and production-grade evaluation.

### Practical priority order

Once P1–P3 land, the next three — still in priority order — are ERC-8004 identity, curator agents, and runtime extraction. Labels below are qualitative; the 1–5 numeric rubric lives in §3 above.

| Priority | Initiative | Why now | Main dependency | Risk |
|---|---|---|---|---|
| **P1** | MCP server | Best immediate leverage from shipped OpenAPI + x402 work | none | low (additive; real risk is over-designing v1) |
| **P2** | pgvector migration | Unblocks learning loop and better similarity tooling | Prisma migration discipline | low/medium |
| **P3** | Langfuse + golden-set evals | Gives a real quality bar before more agent complexity | stable eval scenarios | low |
| **P4** | ERC-8004 identity + reputation | Strongest differentiated on-chain signal | runtime boundaries clearer | medium/high |
| **P5** | Curator agents | Solves the blind-buy problem with a visible wedge | ERC-8004 reputation surface, embeddings | high |
| **P6** | Runtime extraction | Valuable, but easier after one external interface ships | clearer module seams | high |

### Suggested PR slices

These are the smallest slices that would keep momentum high and reviewable.

#### MCP server

1. **PR 1: MCP scaffold**
   - Add `backend/src/modules/mcp/`
   - Stand up `/mcp` and `/.well-known/mcp.json`
   - Expose one read-only tool such as `catalog.search`

2. **PR 2: commercial tools**
   - Add `stem.quote`, `stem.download`, `generate.track`
   - Reuse existing x402 middleware for paid tools

3. **PR 3: productization**
   - Basic docs, example client, and discovery metadata for external MCP clients

#### pgvector migration

1. **PR 1: schema + storage**
   - Add `vector(...)` column and index
   - Backfill embeddings for a small bounded set

2. **PR 2: read path**
   - Switch `embeddings.similarity` and selector lookups to Postgres-backed search

3. **PR 3: cleanup**
   - Retire or narrow the in-memory `EmbeddingStore`

#### Langfuse + evals

1. **PR 1: tracing**
   - Instrument ADK runner, tool calls, and purchase decisions

2. **PR 2: golden set**
   - Start with ~100 canonical curation scenarios with expected rubric dimensions; grow toward 200 as coverage gaps appear

3. **PR 3: CI gate**
   - Add a non-blocking CI eval job first, then promote to a quality gate once stable

### Effort and risk notes

- **MCP server** has the best ratio of visibility to effort, but the real risk is over-designing the first version. The first ship should be narrow and boring.
- **pgvector** is mostly execution risk, not product risk. The key is keeping the migration and backfill straightforward.
- **Langfuse** is low implementation risk, but only valuable if the team commits to maintaining a golden set and actually reading the traces.
- **ERC-8004** should stay in view, but it becomes much more credible once there is a measurable learning loop and a portable runtime boundary behind it.

### Still on the roadmap (Wave 3), just not next

- **Human-facing x402 checkout** — small wrapper around shipped middleware; ships whenever the buy modal gets its next pass.
- **Agentic.Market / x402scan registration ([#520](https://github.com/akoita/resonate/issues/520))** — blocked on a public host, not on engineering.

### What I would explicitly defer

- **Real-time remix engine** — huge upside, but this is a moat project, not a next-step foundation project.
- **Mastra** — plausible fit, but not yet necessary while the NestJS + Next.js shape is still workable.
- **A2A peer mesh** — interesting, but it should be earned by real coordination pain, not adopted because it is fashionable.
- **Proof-of-inference / Ritual / EZKL** — good proof-of-concept material, weak near-term leverage.

---

## 6. One-paragraph executive pitch

Resonate already has the skeleton of a senior-eng flagship project: ADK agent runtime, ERC-4337 smart wallet, x402 paywall, Lyria generation, a full dashboard. The three next moves — the ones that give the platform a real foundation before adding more agent surface area — are: **(a)** expose the platform itself as an MCP server (with x402-gated tools) so external agents can buy stems natively, **(b)** move the embedding substrate from in-memory to pgvector, and **(c)** stand up Langfuse + a ~100-item golden set. The headline follow-ups — ERC-8004 identity + reputation, curator agents, and runtime extraction per RFC #424 — then land on measurable ground, and the rest (Claude Agent SDK subagents, Mastra on the frontend, Letta memory, the remix engine with ACE-Step + Demucs) stacks naturally on top. Avoid the LangChain/Spleeter/Suno-wrapper dead ends.

---

## 7. Key sources

**Internal:**
- [docs/rfc/RESONATE_SPECS.md](RESONATE_SPECS.md)
- [docs/rfc/agent-platform-refactor.md](agent-platform-refactor.md)
- [docs/account-abstraction/agentic_ai_orchestration.md](../account-abstraction/agentic_ai_orchestration.md)
- [docs/security/agent-wallet-security.md](../security/agent-wallet-security.md)
- [docs/features/agent-platform-refactor-backlog.md](../features/agent-platform-refactor-backlog.md)
- [AGENTS.md](../../AGENTS.md)

**Issues:** [#424](https://github.com/akoita/resonate/issues/424) · [#291](https://github.com/akoita/resonate/issues/291) · [#322](https://github.com/akoita/resonate/issues/322) · [#290](https://github.com/akoita/resonate/issues/290) · [#323](https://github.com/akoita/resonate/issues/323) · [#306](https://github.com/akoita/resonate/issues/306) · [#307](https://github.com/akoita/resonate/issues/307) · [#499](https://github.com/akoita/resonate/issues/499) · [#520](https://github.com/akoita/resonate/issues/520) · [#408](https://github.com/akoita/resonate/issues/408)

**Ecosystem primary sources (authoritative as of 2026-04-22):**
- Claude Agent SDK — https://platform.claude.com/docs/en/agent-sdk/overview
- Mastra — https://mastra.ai/
- LangGraph 1.0 — https://blog.langchain.com/langchain-langgraph-1dot0/
- MCP — https://modelcontextprotocol.io/specification/2025-11-25
- x402 — https://www.x402.org/ · Coinbase https://docs.cdp.coinbase.com/x402/welcome
- ERC-8004 — https://eips.ethereum.org/EIPS/eip-8004
- Coinbase AgentKit / Agentic.Market — https://github.com/coinbase/agentkit · https://www.coinbase.com/developer-platform/discover/launches/agentic-market
- Demucs — https://github.com/facebookresearch/demucs
- ACE-Step — https://github.com/ace-step/ACE-Step
- Langfuse — https://langfuse.com/
- pgvector — https://github.com/pgvector/pgvector
- Letta — https://www.letta.com/ · Mem0 — https://github.com/mem0ai/mem0
