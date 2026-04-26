# Agent-Opportunities Report — Resonate

**Date:** 2026-04-22
**Author:** @akoita (research-assisted)
**Status:** Roadmap checkpoint — Wave 1 foundation partially shipped

Research pulled from four parallel tracks: **codebase inventory**, **docs/RFCs**, **issue backlog (318 issues / 45 PRs mined)**, and **Q1/Q2-2026 ecosystem survey** (primary sources). Below is the synthesis, then ranked opportunities, then a staged roadmap.

## 0. 2026-04-25 status update

Issue [#627](https://github.com/akoita/resonate/issues/627) is closed as the
discussion/report vehicle. That does **not** mean the whole agent roadmap is
done. It means the first execution pass from this report has landed enough
foundation to move from "proposal" to normal roadmap tracking.

Shipped or started since this report:

- **MCP foundation shipped** — `backend/src/modules/mcp/` exposes `/mcp`,
  `GET /mcp`, and `/.well-known/mcp.json`, with `catalog.search`,
  `stem.quote`, and paid `stem.download`. Docs include MCP Inspector, Codex,
  Claude Desktop, Cursor, and the `examples/mcp-client` smoke client.
- **pgvector-backed embeddings shipped** — `TrackEmbedding` and the
  `EmbeddingStore` now persist 16-dimensional vectors in Postgres/pgvector, and
  selector similarity uses that store.
- **Agent observability started** — optional Langfuse-compatible ingestion
  traces policy evals, tool calls, MCP tools, and evaluation summaries.
- **Golden eval harness expanded** — deterministic policy golden cases live
  under `backend/src/evals/`, with `npm run eval:golden` covering 30+ cases,
  rubric-dimension metrics, acceptance/rejection-rate reporting, learned
  preference regression metrics, and CI-uploaded JSON/Markdown artifacts.
- **Agent learning loop first slice shipped** — weighted `AgentSignal` records
  aggregate into `learnedTasteProfile` / `tasteScore`, selector ranking uses
  learned genre weights, and the dashboard shows learned score and explored
  genres.

Still open from the foundation wave:

- MCP does **not** yet expose `generate.track`.
- The golden set is not yet the originally proposed ~100-200 case suite.
- There is no LLM-as-judge grader or blocking CI quality gate for agent evals yet.
- Agentic.Market / x402scan registration is past public endpoint
  availability and now blocked on deployed x402 enablement; see
  [#520](https://github.com/akoita/resonate/issues/520).

Started beyond Wave 1:

- ERC-8004 identity and reputation now has a configurable on-chain adapter:
  local credentials remain the default, while configured environments can mint
  the agent identity through `register(string agentURI)` and publish reputation
  snapshots with `setMetadata(agentId, "resonate.reputation", bytes)`.
  Issue #261 adds official mainnet/testnet Identity Registry defaults and a
  standalone mint/link script for reviewers and operators.

Still open beyond Wave 1:

- Curator agents.
- Unified runtime extraction.
- Learning loop provider-scale expansion and memory integration.
- Memory layer.
- Real remix engine.

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
- **MCP server foundation** — `/mcp` streamable HTTP transport, curl-friendly
  `GET /mcp`, discovery metadata, `catalog.search`, `stem.quote`, and paid
  `stem.download` ([backend/src/modules/mcp](../../backend/src/modules/mcp),
  [docs/architecture/mcp_server.md](../architecture/mcp_server.md)).
- **pgvector embedding store** — `TrackEmbedding` persists similarity vectors in
  Postgres/pgvector and backs `embeddings.similarity`
  ([backend/src/modules/embeddings/embedding.store.ts](../../backend/src/modules/embeddings/embedding.store.ts)).
- **Agent observability first slice** — optional Langfuse-compatible trace
  ingestion plus deterministic golden eval entrypoint
  ([agent_observability.service.ts](../../backend/src/modules/agents/agent_observability.service.ts),
  [backend/src/evals](../../backend/src/evals)).
- **Dashboard UI** — setup wizard, status card, budget ring, taste card, activity feed, history ([web/src/app/agent/page.tsx](../../web/src/app/agent/page.tsx), [web/src/components/agent/](../../web/src/components/agent/)).

**What's planned but unshipped** (from docs + backlog):

- **ERC-8004 identity + reputation** — referenced in [RESONATE_SPECS.md](RESONATE_SPECS.md), [agentic_ai_orchestration.md](../account-abstraction/agentic_ai_orchestration.md), backlog #261, #291, #322. Code has a comment "Prep for ERC-8004 identity" at [AgentTasteCard.tsx:263](../../web/src/components/agent/AgentTasteCard.tsx#L263).
- **Unified runtime extraction** — [RFC agent-platform-refactor.md](agent-platform-refactor.md) + backlog [#424](https://github.com/akoita/resonate/issues/424). "By extracting the agent into its own runtime with a clean API boundary, we naturally create the interface layer that ERC-8004 requires."
- **Curator Agents** — [#322](https://github.com/akoita/resonate/issues/322): "The AI DJ agent currently buys stems blindly — every buyer agent would need to independently analyze audio quality, which is redundant and wasteful."
- **Learning loop / real Taste Score** — [#290](https://github.com/akoita/resonate/issues/290): "The agent makes the same quality of decisions on day 100 as day 1."
- **Real-time remix engine** — [#323](https://github.com/akoita/resonate/issues/323): "`AgentMixerService.plan()` outputs a transition type string … but never touches audio."
- **LangGraph multi-agent state machine** — [#306](https://github.com/akoita/resonate/issues/306), explicitly parked by RFC until ADK proves insufficient.
- **Full production eval system** — expand the tiny deterministic golden set to
  a maintained scenario suite, add rubric / judge evaluation, and promote a
  stable eval job into CI.
- **MCP generation tool** — `generate.track` remains a follow-up after the
  read/quote/download MCP path.

**Previously identified blind spots now partially covered**:

- MCP server exposure moved from blind spot to shipped foundation.
- Vector DB moved from blind spot to pgvector-backed first slice.
- LLM observability moved from blind spot to optional Langfuse-compatible first
  slice.
- Still uncovered: A2A between Selector / Mixer / Negotiator, a real memory
  layer (Mem0 / Letta / Zep), and Claude/OpenAI in the runtime stack.

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

| # | Opportunity | Fit | Trend | Effort (lo=good) | Issue / status |
|---|---|---|---|---|---|
| **1** | **Expose Resonate as an MCP server** (catalog/pricing/stem-download/generate as MCP tools; optional x402 gating via existing middleware) | 5 | 5 | 2 | Foundation shipped; `generate.track` remains |
| **2** | **Ship ERC-8004 Agent Identity + Reputation** — agent soulbound NFT, periodic taste/reputation attestations tied to `AgentConfig` | 5 | 5 | 3 | [#291](https://github.com/akoita/resonate/issues/291), [#261](https://github.com/akoita/resonate/issues/261) |
| **3** | **Curator agents publishing on-chain quality scores** via ERC-8004 Validation registry — fixes "buys stems blindly" problem | 5 | 5 | 3 | [#322](https://github.com/akoita/resonate/issues/322) |
| **4** | **Langfuse + rubric LLM-as-judge + golden set (start ~100, grow to 200)** — replace home-grown eval harness with the 2026 production pattern | 4 | 5 | 2 | First tracing + tiny golden set shipped; suite/rubric/CI remain |
| **5** | **Migrate `EmbeddingStore` → pgvector** (already Prisma/Postgres) — unblocks real taste similarity + learning loop | 5 | 4 | 2 | First pgvector path shipped; provider-scale embeddings/HNSW remain |
| **6** | **Agent Learning Loop** — signal-weighted taste evolution, real Taste Score on dashboard; feeds into ERC-8004 attestation | 5 | 4 | 3 | [#290](https://github.com/akoita/resonate/issues/290) |
| **7** | **Unified agent runtime extraction** — single `AgentRuntimeService` entrypoint + standalone runtime worker boundary + `PaymentRouterService` (x402 ∥ ERC-4337) + `PolicyGuardService`; prerequisite to publishing the agent as its own MCP-ready process | 5 | 4 | 4 | [#424](https://github.com/akoita/resonate/issues/424), [RFC](agent-platform-refactor.md) |
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

### Wave 1 — Foundations + first high-signal ship (partially shipped)

Goal: three small, shippable PRs that each land a trend flag without a refactor.

1. **MCP server** (foundation shipped).
   - Shipped: `backend/src/modules/mcp/`, official `@modelcontextprotocol/sdk`,
     streamable-HTTP transport, `/mcp`, `GET /mcp`, `/.well-known/mcp.json`,
     `catalog.search`, `stem.quote`, paid `stem.download`, and productization
     docs/client examples.
   - Remaining: `generate.track` and any deeper paid-generation policy.
   - Outcome: Resonate is *discoverable by MCP-aware agents* and can be tested
     from MCP Inspector, Codex, Claude Desktop, Cursor, and the repo smoke
     client.

2. **pgvector migration** (first slice shipped) — `EmbeddingStore` now persists
   the current 16-dimensional local embedding shape in `TrackEmbedding` using
   pgvector. Provider-scale embeddings and HNSW/ANN indexing remain follow-ups.
   This directly improves selector similarity and is a prerequisite for issue
   [#290](https://github.com/akoita/resonate/issues/290).

3. **Langfuse + golden-set eval** (expanded) — optional Langfuse-compatible
   ingestion now traces policy evals, tool calls, MCP tool calls, and evaluation
   summaries. A deterministic golden set lives under `backend/src/evals/` and
   now emits JSON plus Markdown artifacts with rubric dimensions and learned
   preference regression metrics. Remaining: grow toward ~100-200 curated
   scenarios, add an LLM-as-judge grader, and consider a blocking quality gate
   only after the suite is stable.

### Wave 2 — Identity, reputation, and agent-as-a-brand (≈ 5–7 weeks)

Goal: ship the two most scarce on-chain primitives (ERC-8004 + curator attestations) and extract the agent runtime as its own publishable unit.

4. **ERC-8004 Agent Identity mint** (closes [#291](https://github.com/akoita/resonate/issues/291) / [#261](https://github.com/akoita/resonate/issues/261)).
   - Deploy or integrate the public ERC-8004 Identity Registry on Base.
   - On first agent activation, mint a soulbound NFT bound to the user's ERC-4337 smart account; metadata `{ agentId, vibes, monthlyCapUsd, createdAt }`.
   - Wire into [AgentSetupWizard](../../web/src/components/agent/AgentSetupWizard.tsx) after budget step.
   - First slice: local identity metadata, reputation snapshots, and credential export are documented in [agent_identity_reputation.md](../architecture/agent_identity_reputation.md).
   - #261 adds official Identity Registry defaults plus the standalone mint/link script; remaining work is periodic reputation publishing and independent validation/feedback.

5. **ERC-8004 Reputation attestations** — cron job publishes periodic attestations `{ tracksCurated, acceptanceRate, avgBudgetUtilization, genreBreakdown, tasteDepth }` from the learning loop.

6. **Curator Agent (Claude Agent SDK subagent)** — issue [#322](https://github.com/akoita/resonate/issues/322) now has the backend quality-rating foundation: `StemQualityRating`, a curator analyzer for RMS energy, spectral density, silence ratio, and musical salience, ERC-8004 task-shaped metadata publication, buyer-side quality ranking, and validation-driven curator reputation deltas. Remaining product work is to replace the deterministic analyzer with a richer subagent/audio model and move task publication to a dedicated ERC-8004 Validation Registry when that deployed interface is selected.

7. **Agent runtime extraction** ([#424](https://github.com/akoita/resonate/issues/424)) — extract `AgentRuntimeService` + `PaymentRouterService` + `PolicyGuardService` into a standalone NestJS app or Node service. Opens the door to public-agent composability and becomes the "binary" an outside ERC-8004-compatible agent talks to.

### Wave 3 — Remix engine + memory + human-facing x402 (≈ 6–10 weeks)

Goal: the creative moonshot.

8. **Real-time remix engine** ([#323](https://github.com/akoita/resonate/issues/323)) — `Demucs htdemucs_ft` for separation (already in workers/demucs), `ACE-Step v1.5` melody-conditioned for 20-sec remix continuations, optional `AudioShake` API for commercial-rights tracks. Replace `AgentMixerService.plan()` stub.

9. **Letta + Mem0 memory stack** ([#290](https://github.com/akoita/resonate/issues/290), [#307](https://github.com/akoita/resonate/issues/307)) — Letta's self-editing core/archival/recall for the *DJ's* profile (what it has learned about itself), Mem0 for the *user's* session/context memory. Real "Taste Score" derived from Letta's memory trajectory.

10. **Human-facing x402 buy flow** — add a "Pay with USDC (x402)" option to the stem buy modal; reuses existing middleware. Closes the UX gap where x402 is agent-only today.

11. **Register in Agentic.Market + x402scan** ([#520](https://github.com/akoita/resonate/issues/520)) — deploy the OpenAPI + MCP endpoints to a public host and submit.

---

## 5. What I would actually do next

If the goal is to continue execution from the 2026-04-25 checkpoint rather than
read the original RFC as frozen history, the next bets are:

1. **Finish the eval foundation**
   - Status: first expansion is in progress via
     [#692](https://github.com/akoita/resonate/issues/692).
   - Remaining: grow from 30+ cases toward the 100-200 case target and add an
     LLM-as-judge grader once deterministic coverage stops catching the obvious
     regressions.

2. **Register machine-discovery endpoints once public host availability is fixed**
   - Complete [#520](https://github.com/akoita/resonate/issues/520) when
     `/openapi.json`, `/.well-known/x402`, and MCP metadata are publicly
     reachable from the deployed API.

3. **Start Wave 2 with ERC-8004 identity/reputation**
   - This is the next differentiated on-chain agent primitive now that MCP and
     pgvector foundation work has landed.

I would still **not** start with the remix engine. It remains a moat project,
not the next foundation project.

### Practical priority order

As of 2026-04-25, P1/P2 have landed as first slices and P3 has started. The
next priorities are now the remaining eval work, public registration, and then
Wave 2 identity/reputation.

| Priority | Initiative | Status | Main dependency | Risk |
|---|---|---|---|---|
| **P1** | MCP server | Foundation shipped; `generate.track` remains | paid-generation policy | low/medium |
| **P2** | pgvector migration | First slice shipped; provider-scale embeddings/HNSW remain | embedding provider choice | medium |
| **P3** | Langfuse + golden-set evals | Expanded first suite; judge/gate remain | stable eval scenarios | low |
| **P4** | Public agent registration | Blocked by deployed x402 enablement | deployed API metadata | low once unblocked |
| **P5** | ERC-8004 identity + reputation | Started via #291 | registry deployment + session-key approval | medium/high |
| **P6** | Curator agents | Not started | ERC-8004 reputation surface, embeddings | high |
| **P7** | Runtime extraction | Not started | clearer module seams | high |

### Suggested PR slices

These are the smallest slices that would keep momentum high and reviewable.

#### MCP server

1. **PR 1: MCP scaffold**
   - Add `backend/src/modules/mcp/`
   - Stand up `/mcp` and `/.well-known/mcp.json`
   - Expose one read-only tool such as `catalog.search`
   - Status: shipped, with `GET /mcp` capability check.

2. **PR 2: commercial tools**
   - Add `stem.quote`, `stem.download`, `generate.track`
   - Reuse existing x402 middleware for paid tools
   - Status: `stem.quote` and paid `stem.download` shipped; `generate.track`
     remains.

3. **PR 3: productization**
   - Basic docs, example client, and discovery metadata for external MCP clients
   - Status: shipped for Inspector, Codex, Claude Desktop, Cursor, and
     `examples/mcp-client`.

#### pgvector migration

1. **PR 1: schema + storage**
   - Add `vector(...)` column and index
   - Backfill embeddings for a small bounded set
   - Status: first schema/storage slice shipped with `TrackEmbedding`.

2. **PR 2: read path**
   - Switch `embeddings.similarity` and selector lookups to Postgres-backed search
   - Status: shipped for current 16-dimensional embedding path.

3. **PR 3: cleanup**
   - Retire or narrow the in-memory `EmbeddingStore`
   - Status: no longer in-memory for persisted track embeddings; future cleanup
     is about provider-scale embeddings and indexing rather than deleting a
     memory-only store.

#### Langfuse + evals

1. **PR 1: tracing**
   - Instrument ADK runner, tool calls, and purchase decisions
   - #677 starts this slice with optional Langfuse-compatible ingestion and deterministic policy golden evals
   - Status: shipped as a first slice.

2. **PR 2: golden set**
   - Start with ~100 canonical curation scenarios with expected rubric dimensions; grow toward 200 as coverage gaps appear
   - Status: first expansion in [#692](https://github.com/akoita/resonate/issues/692) adds 30+ deterministic scenarios, rubric-dimension aggregates, acceptance/rejection-rate reporting, learned-preference regression metrics, and CI-visible JSON/Markdown artifacts.

3. **PR 3: CI gate**
   - Add a non-blocking CI eval job first, then promote to a quality gate once stable
   - Status: non-blocking artifact reporting is in place; a blocking gate remains deferred.

### Effort and risk notes

- **MCP server** has the best ratio of visibility to effort, but the real risk is over-designing the first version. The first ship should be narrow and boring.
- **pgvector** is mostly execution risk, not product risk. The key is keeping the migration and backfill straightforward.
- **Langfuse** is low implementation risk, but only valuable if the team commits to maintaining a golden set and actually reading the traces.
- **ERC-8004** should stay in view, but it becomes much more credible once there is a measurable learning loop and a portable runtime boundary behind it.

### Still on the roadmap (Wave 3), just not next

- **Human-facing x402 checkout** — small wrapper around shipped middleware; ships whenever the buy modal gets its next pass.
- **Agentic.Market / x402scan registration ([#520](https://github.com/akoita/resonate/issues/520))** — public metadata is live; staging still needs x402 enabled before scanners can validate a concrete 402 challenge.

### What I would explicitly defer

- **Real-time remix engine** — huge upside, but this is a moat project, not a next-step foundation project.
- **Mastra** — plausible fit, but not yet necessary while the NestJS + Next.js shape is still workable.
- **A2A peer mesh** — interesting, but it should be earned by real coordination pain, not adopted because it is fashionable.
- **Proof-of-inference / Ritual / EZKL** — good proof-of-concept material, weak near-term leverage.

---

## 6. One-paragraph executive pitch

Resonate now has the skeleton of a senior-eng flagship project plus the first
machine-facing agent foundation: ADK agent runtime, ERC-4337 smart wallet, x402
paywall, Lyria generation, full dashboard, MCP server, pgvector-backed
similarity, and optional Langfuse-compatible trace export. The next compounding
moves are to finish the eval system, complete public registry submission once
the public metadata endpoints are reachable, and then ship ERC-8004 identity +
reputation. Curator agents, runtime extraction, memory, and the remix engine
should land after those foundations are measurable and externally discoverable.
Avoid the LangChain/Spleeter/Suno-wrapper dead ends.

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
