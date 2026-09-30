---
title: "Taste Engine Decisions (ADR-TE-1…7)"
status: accepted
owner: "@akoita"
created: "2026-09-30"
related:
  - docs/strategy/ai-dj-taste-engine-2026-09.md
  - docs/rfc/taste-engine.md
  - docs/roadmap/2026-10-taste-engine-milestones.md
  - docs/strategy/business-model-phase0-decisions.md
---

# Taste Engine Decisions (ADR-TE-1…7)

Seven ADR-style decisions that turn the
[AI DJ rethink](ai-dj-taste-engine-2026-09.md) into binding rules for the
agent, the recommendation stack and the listener-facing discovery surfaces.
The design that implements them is the [Taste Engine RFC](../rfc/taste-engine.md).

Decision status legend: **proposed** → accepted when the decision issue is
closed with a decision comment by the owner. An accepted decision is then
reflected in the affected feature pages and, where it changes a feature pitch
(the Listener Pro "AI DJ" description), reconciled into
[`docs/rfc/business-model.md`](../rfc/business-model.md). None of these
decisions changes a fee, a split or a price.

ADR-TE-1…6 were accepted as written by the owner on 2026-09-30 and recorded on
[#1953](https://github.com/akoita/resonate/issues/1953). ADR-TE-7 is proposed in
[#1976](https://github.com/akoita/resonate/issues/1976).

Context: the autonomous stem-buying AI DJ and the agent-commerce showcase around
it were built to explore the architecture, not for a customer. These decisions
keep what that work proved and align the product with the business vision
(ADR-BM-6).

These decisions sit under the accepted business-model decisions
([ADR-BM-1…6](business-model-phase0-decisions.md)) and reopen none of them.

---

## ADR-TE-1 — The agent spends only on a quote a human approved

> **Status: ACCEPTED — 2026-09-30, confirmed by @akoita** ([#1953](https://github.com/akoita/resonate/issues/1953)).

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
  4. Autonomous stem buying by the listener AI DJ stops: no listener preset
     selects `buy` mode (today the Hype and Dark presets do), and `buy` mode
     sits behind an operator flag that defaults off until it is removed once
     the Crate Digger quote flow ships.
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

> **Status: ACCEPTED — 2026-09-30, confirmed by @akoita** ([#1953](https://github.com/akoita/resonate/issues/1953)).

- **Decision:** Resonate publishes and enforces six recommendation rules:
  1. **No paid ranking.** No artist, label or partner can pay, accept a lower
     rate, or trade a benefit to rank higher in recommendations, sessions,
     charts or crates. Paid placements, if they ever exist, are labeled as ads
     and live outside recommendation surfaces. Commercial status is not a
     lever either: having stems for sale never raises a track in listener
     recommendations; it is a filter DJs choose in the Crate Digger.
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

> **Status: ACCEPTED — 2026-09-30, confirmed by @akoita** ([#1953](https://github.com/akoita/resonate/issues/1953)).

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

> **Status: ACCEPTED — 2026-09-30, confirmed by @akoita** ([#1953](https://github.com/akoita/resonate/issues/1953)).

- **Decision:**
  1. Listening sessions never insert AI-generated tracks to pad a sparse
     catalog. When the catalog cannot fill an intent, the session says so
     honestly ("12 minutes found of 40") and the gap is recorded as demand for
     Scene Scout.
  2. Session transitions are never generated. The unused Lyria transition
     and fill path is removed; transitions are deterministic DSP
     (tempo-synced crossfade, EQ blend, filter sweep) with no GPU cost.
  3. Any AI generation that remains in a product surface is billed in credits
     under ADR-BM-3.
- **Why:** the orchestrator, which serves admin and evaluation routes today,
  pads a sparse selection with generated tracks, which would contradict
  ADR-BM-5.3 on any listener surface, and the mixer carries an unused path
  that would generate Lyria transitions nobody pays for, which ADR-BM-3
  forbids ("never unmetered access"). Neither reaches listeners today; they
  are removed so that routing the DJ through shared code (#1456) cannot
  switch them on.
- **Consequences:** remove the sparse-catalog generation path and the mixer's
  `generate` path; keep generation where it is billed (Remix Studio credits).

## ADR-TE-5 — Taste is weighted by commitment and owned by the listener

> **Status: ACCEPTED — 2026-09-30, confirmed by @akoita** ([#1953](https://github.com/akoita/resonate/issues/1953)).

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

> **Status: ACCEPTED — 2026-09-30, confirmed by @akoita** ([#1953](https://github.com/akoita/resonate/issues/1953)).

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

## ADR-TE-7 — A stem purchase sells a license, and artists can supply official stems

> **Status: proposed — 2026-09-30.** Extends ADR-TE-3.

- **Decision:**
  1. What a stem listing sells is a **license** (personal, remix or commercial
     today; sync, sample and broadcast later), with its terms stated in plain
     words on the listing, the quote and the receipt. The audio file is how the
     license is delivered, not the product.
  2. Artists can upload **official stems** for a track: their own lossless
     (WAV or FLAC) parts, aligned with the published mix. Official stems are
     delivered lossless and labeled "Official".
  3. Stems separated from the mix by the ingestion worker stay available and
     are labeled "Separated (AI)", with the model named. The artist can price
     each source separately; Resonate sets no price floor.
  4. Only an account on the release's rights route can upload official stems,
     under the same verification as the release (ADR-BM-5).
  5. The Crate Digger and the marketplace can filter by stem source.
- **Why:** today every stem is separated by Demucs from the uploaded mix and
  stored as MP3 320 kbps ([upload flow](../features/artist_upload_flow_mvp.md)).
  DJ software already separates any track live on the DJ's own machine, so
  separated audio alone gives a professional little reason to pay. What a pro
  cannot get elsewhere is the right to publish or monetize a remix, an edit or a
  video, and the artist's own lossless parts. Selling the license, with official
  stems as the premium source, matches what the buyers in the Crate Digger and
  Remix Studio need.
- **Consequences:** the stem model records its source; ingestion accepts an
  optional official stem package per track, checked for count, duration and
  alignment with the mix; listings, quotes and receipts show the source and the
  license terms; a User Guide page explains each license tier. Revenue line:
  Line 3, marketplace take-rate 10%, phase 2; no fee, split or price change,
  and the artist keeps at least 85% (ADR-BM-4).
- **Revisit later:** better in-house separation and production tools could
  spare artists from uploading stems, which is why official upload stays
  optional. Separation quality alone is not a differentiator, since DJ software
  ships comparable separation; the license and easy remix tools are. Remix
  tools for listeners grow through Remix Studio
  ([#1896](https://github.com/akoita/resonate/issues/1896)), not the listening
  app, and neither is pitched as a differentiator of the listening app until
  usage shows it.
- **Amendment under discussion (proposed 2026-09-30): the value test for
  every charge.** Asking a customer to pay is a sensitive decision. Before any
  price ships, Resonate must be able to answer four questions, first for itself
  and then in plain words on the page where the customer pays:
  1. **What does the customer get that they cannot get free elsewhere?**
  2. **Who receives the money?** The artist's share is shown on the quote.
  3. **What free alternative does it beat, and how?**
  4. **What evidence shows people want it at this price?** Until there is
     evidence, the feature ships free behind an entitlement seam, as the
     `crate.pro` seam does (#1966).

  Applied to today's charges and options:

  | Charge | Answer to question 1 | Verdict |
  | --- | --- | --- |
  | Remix or commercial license | The right to publish or monetize a remix, an edit or a video, which ripping or local separation does not give | Justified; stays per track |
  | Personal license on a separated stem | Almost nothing: DJ software separates the same track locally for free | Weak; review whether personal use of separated stems should be free with the stream |
  | Official lossless stems | The artist's own parts, not available anywhere else | Justified if the artist uploads them |
  | Pro tier for DJs and producers (Crate Digger, Remix Studio Pro, exports) | Time saved finding rights-clear music, and exports to DJ software | Plausible; stays free until beta usage shows it |
  | Monthly license credits bundled in the pro tier | Only valuable to people who license several tracks a month | Deferred: without repeat license buying, credits are paying for nothing |
  | Listener Pro | Plays that pay the artists you play, HiFi, the Session DJ | Gated on the Listener Pro WAU threshold (ADR-BM-6) |

  Any price change this implies goes through `docs/rfc/business-model.md`
  (canonical fees and prices); this amendment changes none.

---

## Decision tracking

| Decision | Issue | Status |
| --- | --- | --- |
| Umbrella epic | [#1952](https://github.com/akoita/resonate/issues/1952) | open |
| ADR-TE-1…6 | [#1953](https://github.com/akoita/resonate/issues/1953) | accepted 2026-09-30 |
| ADR-TE-7 | [#1976](https://github.com/akoita/resonate/issues/1976) | proposed |

Implementation issues per decision:

| Decision | Issues |
| --- | --- |
| ADR-TE-1 — Quote before spend | [#1954](https://github.com/akoita/resonate/issues/1954), [#1964](https://github.com/akoita/resonate/issues/1964), [#1967](https://github.com/akoita/resonate/issues/1967), [#1972](https://github.com/akoita/resonate/issues/1972), [#1974](https://github.com/akoita/resonate/issues/1974) |
| ADR-TE-2 — No ranking for sale | [#1957](https://github.com/akoita/resonate/issues/1957), [#1970](https://github.com/akoita/resonate/issues/1970) |
| ADR-TE-3 — Stems are a pro asset | [#1959](https://github.com/akoita/resonate/issues/1959), [#1960](https://github.com/akoita/resonate/issues/1960), [#1971](https://github.com/akoita/resonate/issues/1971) |
| ADR-TE-4 — No generated filler | [#1956](https://github.com/akoita/resonate/issues/1956) |
| ADR-TE-5 — Commitment-weighted, listener-owned taste | [#1955](https://github.com/akoita/resonate/issues/1955), [#1961](https://github.com/akoita/resonate/issues/1961), [#1973](https://github.com/akoita/resonate/issues/1973), [#1455](https://github.com/akoita/resonate/issues/1455) |
| ADR-TE-6 — Freeze showcase work | [#1958](https://github.com/akoita/resonate/issues/1958) |
| ADR-TE-7 — Sell the license, official stems | [#1976](https://github.com/akoita/resonate/issues/1976) |

Accepting a decision: the owner comments on the decision issue with the
decisions accepted (all, or a subset with changes), and the status lines above
are updated in the same PR that reconciles the affected feature pages.
