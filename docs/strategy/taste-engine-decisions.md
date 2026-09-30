---
title: "Taste Engine Decisions (ADR-TE-1…6)"
status: proposed
owner: "@akoita"
created: "2026-09-30"
related:
  - docs/strategy/ai-dj-taste-engine-2026-09.md
  - docs/rfc/taste-engine.md
  - docs/roadmap/2026-10-taste-engine-milestones.md
  - docs/strategy/business-model-phase0-decisions.md
---

# Taste Engine Decisions (ADR-TE-1…6)

Six ADR-style decisions that turn the
[AI DJ rethink](ai-dj-taste-engine-2026-09.md) into binding rules for the
agent, the recommendation stack and the listener-facing discovery surfaces.
The design that implements them is the [Taste Engine RFC](../rfc/taste-engine.md).

Decision status legend: **proposed** → accepted when the decision issue is
closed with a decision comment by the owner. An accepted decision is then
reflected in the affected feature pages and, where it changes a feature pitch
(the Listener Pro "AI DJ" description), reconciled into
[`docs/rfc/business-model.md`](../rfc/business-model.md). None of these
decisions changes a fee, a split or a price.

These decisions sit under the accepted business-model decisions
([ADR-BM-1…6](business-model-phase0-decisions.md)) and reopen none of them.

---

## ADR-TE-1 — The agent spends only on a quote a human approved

> **Status: proposed — 2026-09-30.**

- **Decision:**
  1. No Resonate agent (the listener DJ, the Crate Digger, an external agent
     through MCP or x402) buys anything without a priced quote that a person
     has seen and approved. The quote lists each line, the rights obtained,
     the price, the artist share and the platform fee.
  2. The only standing authorization is **pay-per-play settlement from a
     capped, pre-funded Listener Pro budget**: the listener funds the budget,
     sets the cap, and each play settles to the artist played. It never buys
     rights, stems or licenses.
  3. Opt-in "bounded watching" for DJs (auto-buy of new releases matching a
     saved crate, under a per-item and monthly cap, with the existing session
     keys) is allowed because the person wrote the rule and the cap. It is off
     by default and every purchase produces a receipt and a notification.
  4. Autonomous stem buying by the listener AI DJ is turned off by default
     behind a flag, then removed once the Crate Digger quote flow ships.
- **Why:** listeners want to listen and support, not to own stems; DJs want to
  choose what they pay for. A purchase nobody asked for is a support ticket, a
  refund and a trust loss. The quote-first rule also makes every agent money
  flow explainable, which the payout doctrine (ADR-BM-4) and the external
  agent contract (#1006) already require.
- **Consequences:** the negotiator and the ERC-4337 purchase path are reused
  behind a quote step; Sonic Radar stops being a purchase log (ADR-TE-5,
  [RFC §6](../rfc/taste-engine.md)); external agents keep the same quote,
  receipt and error contract.

## ADR-TE-2 — No ranking for sale, and public recommendation rules

> **Status: proposed — 2026-09-30.**

- **Decision:** Resonate publishes and enforces six recommendation rules:
  1. **No paid ranking.** No artist, label or partner can pay, accept a lower
     rate, or trade a benefit to rank higher in recommendations, sessions,
     charts or crates. Paid placements, if they ever exist, are labeled as ads
     and live outside recommendation surfaces.
  2. **Guaranteed exploration.** Every listener session and every
     recommendation page reserves an exploration share for verified human
     artists the listener has never played.
  3. **AI kept off human surfaces.** Fully AI-generated content never appears
     in human-artist promotional surfaces or in listener sessions unless the
     listener explicitly asked for it (ADR-BM-5.3).
  4. **Categorical explanations.** Every recommendation carries a reason a
     person can read ("because you saved three Afrobeat tracks this month"),
     never an itemized history of another listener.
  5. **Manipulation-protected signals.** Signals from unverified, new or
     anomalous accounts are down-weighted; purchases and pledges count only
     after settlement; self-plays and self-purchases never count for the
     artist's own reach.
  6. **Declared taste beats inferred taste.** A listener's explicit choice
     (hide, downrank, "less of this", a written preference) overrides anything
     the model inferred.
- **Why:** the strongest competitor behavior to beat is visibility sold for
  lower royalties. Resonate can promise the opposite in writing because its
  revenue comes from Shows, subscriptions and transactions, not from selling
  attention. Written rules also make recommendation work testable.
- **Consequences:** the rules become assertions in the ranking service and
  the policy stage ([RFC §3.4](../rfc/taste-engine.md)); a public page in the
  in-app User Guide states them; any future paid feature touching visibility
  must open a new ADR.

## ADR-TE-3 — Stems are a professional asset, not the listener DJ's headline

> **Status: proposed — 2026-09-30.**

- **Decision:**
  1. The listener DJ (the Session DJ) mixes **full tracks**, using measured
     tempo, key and energy and the deterministic DSP already shipped in Remix
     Studio. It does not separate, preview or buy stems.
  2. Stems remain first-class for DJs and producers: the Crate Digger filters
     by available stems and their quality, Remix Studio uses them, and the
     marketplace licenses them.
  3. Track-level audio features (tempo, key, energy, onset density) are
     measured on the **full mix** at ingestion, with a backfill for the
     existing catalog. Stem-level features stay where they help pros.
- **Why:** stems were a strong technical learning subject early on. For
  listeners they add little; separation artifacts would be audible on a
  professional-quality stream, and the value of stems sits with the people who
  license them. Today features are measured only on separated stems and the
  ranker uses metadata-inferred features, so full-mix measurement is a
  prerequisite for real mixing and audio-aware discovery anyway.
- **Consequences:** full-mix measurement becomes foundation work
  ([RFC §3.2](../rfc/taste-engine.md)); Sonic Radar is no longer tied to stems;
  the "stem preview in the player" pitch in the Listener Pro description moves
  to the pro tier on acceptance.

## ADR-TE-4 — No generated filler or unmetered generation in listening sessions

> **Status: proposed — 2026-09-30.**

- **Decision:**
  1. Listening sessions never insert AI-generated tracks to pad a sparse
     catalog. When the catalog cannot fill an intent, the session says so
     honestly ("12 minutes found of 40") and the gap is recorded as demand for
     Scene Scout.
  2. Lyria-generated transitions and fills are removed from listening
     sessions. Transitions are deterministic DSP (tempo-synced crossfade,
     EQ blend, filter sweep) with no GPU cost.
  3. Any AI generation that remains in a product surface is billed in credits
     under ADR-BM-3.
- **Why:** the orchestrator inserts generated tracks into sessions that
  promote artists, which contradicts ADR-BM-5.3, and each Lyria transition
  costs money that nobody pays, which ADR-BM-3 forbids ("never unmetered
  access").
- **Consequences:** remove the sparse-catalog generation path and the mixer's
  Lyria calls; keep generation where it is billed (Remix Studio credits).

## ADR-TE-5 — Taste is weighted by commitment and owned by the listener

> **Status: proposed — 2026-09-30.**

- **Decision:**
  1. The taste model has five layers, weighted in this order: **commitment**
     (purchases, Shows pledges, collected moments, published remixes, follows)
     > **declared** (written preferences, hides, "less of this") >
     **behavioral** (full plays, replays, saves, skips) > **context** (session
     intent, time, device) > **scene** (city and community aggregates).
  2. The ranking objective is **resonance**, not listening time: a track
     resonates when it is played in full and then replayed or saved within
     seven days. The north-star metric is **resonant discoveries** per active
     listener: resonant tracks by artists the listener had never played.
  3. The listener can see, edit, export and reset their taste profile (the
     **taste passport**). Export is a documented, portable format.
  4. A listener's "tastemaker" status (having discovered artists early) is
     recognition and utility only: a badge, early access, or a perk an artist
     grants. Resonate never pays listeners for taste (ADR-BM-4.3).
- **Why:** commitment signals are the one thing a commerce platform has that a
  streaming service does not, and they are the hardest to fake. Optimizing
  resonance rewards the discovery Resonate exists for instead of background
  listening. A portable, editable profile is a trust promise competitors do not
  make.
- **Consequences:** new signal types and weights in the learning loop
  ([RFC §3.1](../rfc/taste-engine.md)); resonant discoveries replace "total
  spent" as Sonic Radar's headline; the quality dashboard adds the metric.

## ADR-TE-6 — Freeze showcase agent work

> **Status: proposed — 2026-09-30.**

- **Decision:** freeze new work on ERC-8004 identity and reputation
  publishing, on-chain curator agents, and agent-to-agent negotiation that no
  person asked for. Shipped code stays behind its flags; it is not removed
  unless it blocks another change. Work resumes only through a new ADR that
  names a user and a revenue line.
- **Why:** these slices proved technology but serve no current customer, and
  every hour spent on them is an hour not spent on the Crate Digger, Scene
  Scout or Listener Pro readiness.
- **Consequences:** related open issues are relabeled or closed with a pointer
  to this decision; the AI DJ feature pages mark those slices as frozen.

---

## Decision tracking

| Decision | Issue | Status |
| --- | --- | --- |
| Umbrella epic | _to be filed_ | open |
| ADR-TE-1…6 | _to be filed_ | proposed |

Accepting a decision: the owner comments on the decision issue with the
decisions accepted (all, or a subset with changes), and the status lines above
are updated in the same PR that reconciles the affected feature pages.
