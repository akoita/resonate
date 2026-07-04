---
title: "Business Model v2 — Phase-0 Decisions (ADR-BM-1…6)"
status: proposed
owner: "@akoita"
created: "2026-07-04"
related:
  - docs/strategy/business-model-review-2026-07.md
  - docs/rfc/business-model.md
---

# Business Model v2 — Phase-0 Decisions

Six ADR-style decisions that convert the [business-model review](business-model-review-2026-07.md)
into committed, canonical numbers. Each section is written to be filed as its
own GitHub issue (ready-to-file `gh` commands at the bottom), plus one epic
that tracks them all.

Decision status legend: **proposed** → accepted when the corresponding issue
is closed with a decision comment; the accepted numbers must then be
reconciled into `docs/rfc/business-model.md` as the single canonical source.

---

## ADR-BM-1 — Shows campaign platform fee

> **Status: ACCEPTED — 2026-07-04, confirmed by @akoita.** Canonical fee
> reconciled into `docs/rfc/business-model.md` (Layer 4). Implementation
> tracked in [#1330](https://github.com/akoita/resonate/issues/1330)
> (blocking for the #1271 production go-live).

- **Decision (accepted):** 6% platform fee, charged **only on successfully
  funded campaigns**, deducted at release time (not at pledge time). Failed or
  cancelled campaigns refund 100% of pledges — the refund-first promise stays
  intact.
- **Why:** Kickstarter's 5% + payment processing is the accepted market rate
  for success-fee crowdfunding; Shows is Resonate's closest-to-PMF real-money
  feature; success-only fees align platform incentives with artists and fans.
- **Implementation constraint:** the fee parameter (basis points +
  fee-recipient address) must land in `ShowCampaignEscrow` **before** the
  gated production deploy (#1271). A fee added after deployment is a custody-
  contract migration; added now it is a constructor argument. Follow the full
  contract test ladder (unit/fuzz/invariant/formal) for the fee-accounting
  paths — funds-conservation invariants must include the fee sink.
- **Consequences:** first live revenue line; campaign pages must display the
  fee honestly ("6% platform fee on funded campaigns") per the honest-cost
  display convention.

## ADR-BM-2 — Marketplace take-rate alignment

- **Decision (proposed):** platform take is **10%** on marketplace sales
  (stems, downloads, collectibles, remix/commercial licenses) and **15%** on
  x402 micro-purchases (personal tier). Raise the `StemMarketplaceV2` protocol
  fee default from 0.5%; if the current max-fee cap (5%) is below the decided
  rate, the cap change ships through the contract-upgrade path with full test
  ladder.
- **Why:** the RFC already documents 10–15% (Bandcamp charges 10–15%,
  BeatStars free tier ~30%); the 0.5% on-chain default contradicts it and
  forfeits ~20x revenue at any GMV. Artist share remains 85–90% after
  royalties — still the headline pitch.
- **Consequences:** one canonical fee table in `docs/rfc/business-model.md`;
  `StemMarketplaceV2` config, x402 defaults (`x402.config.ts`), and
  stem-pricing fallbacks all reference the same numbers; changelog + honest
  fee display in buy modals.

## ADR-BM-3 — AI generation credits (metered billing)

- **Decision (proposed):** bill AI generation (Lyria, Stable Audio 3 remix
  drafts, stem-plus-AI rendering) via **prepaid generation credits** at
  cost + 30–50% margin. Baseline: internal cost ~$0.06/30s → sell at
  ~$0.10/30s equivalent. A small monthly credit allowance is bundled into the
  future Artist Pro tier; overage is pay-as-you-go from the wallet.
- **Why:** GPU inference is the platform's largest variable cost and currently
  billed to no one; Splice/LANDR prove creators pay metered/subscription
  pricing for tools; honest cost display is already implemented — billing is
  the missing half.
- **Dependencies:** resolve the Stable Audio 3 / Gemma T5 PUP license question
  (docs/rfc/stable-audio-3-license-review.md) before charging money for SA3
  outputs; keep the cost/latency adopt-gate (#1193, #1206).
- **Consequences:** Remix Studio E2+ paths gate on credit balance; generation
  events already flow to analytics — add credit-consumption events; free spike
  allowances stay possible via promo credits, never via unmetered access.

## ADR-BM-4 — Payout doctrine & red lines

- **Decision (proposed):** platform-wide payout doctrine:
  1. Artist receives **85%+ of every transaction** (after on-chain royalties
     to other creators), settled in USDC, visible on-chain.
  2. No recoupment, no pool, no minimum-stream thresholds.
  3. Listener-side payouts are **pre-funded and user-centric only** (money
     flows from an identified funded wallet to the artists that wallet's owner
     actually consumed/bought). **Never subsidize payouts from platform funds**
     (no free-tier payouts, no listener rewards) — the pre-funded model is
     structurally fraud-proof precisely because there is no pool to drain.
  4. **No royalty-yield products for fans.** Selling fans a share of future
     income is a security (Howey); Shows pledges remain conditional purchases
     with refunds; punchline drops and collectibles carry utility (access,
     credits, holder benefits), never income rights.
- **Why:** see review §2.3–2.4 — every crypto royalty-share platform died or
  re-papered under securities regulation; pro-rata pools are the fraud vector
  (Deezer: ~85% of AI-track streams fraudulent; ~10% of global streams
  fraudulent per Beatdapp).
- **Consequences:** doctrine paragraph added to `docs/rfc/business-model.md`;
  any future feature proposal touching payouts must state compliance with
  these four rules in its RFC.

## ADR-BM-5 — Monetization identity policy (human verification & AI labeling)

- **Decision (proposed):**
  1. Upload stays open at current trust-ladder friction; **payout eligibility
     requires verified-human status** (proof-of-control today per
     rights-verification RFC; optional proof-of-personhood integration later).
  2. AI involvement is **declared and labeled** end to end: keep
     `ai_generated` release typing, align metadata with the **DDEX
     AI-disclosure standard**, show listener-facing labels.
  3. Fully-AI content gets a **distinct monetization policy** (marketplace
     allowed with disclosure; excluded from human-artist promotional surfaces;
     policy precedents: Deezer exclusion from recommendations, Tidal
     royalty-ineligibility).
  4. Distributors are never required; the trusted-source fast path remains
     optional.
- **Why:** 44% of daily uploads industry-wide are now fully AI-generated
  (Deezer, Apr 2026); no DSP has deployed C2PA/proof-of-personhood yet — open
  differentiation window for "verified human artists, honestly labeled AI."
- **Consequences:** feeds the AI Music Integrity epic (#1164); verification
  states already exist (`approved_with_limits`, `rights_verified`) — wire
  payout gating to them.

## ADR-BM-6 — Revenue-line sequencing & billing stack

- **Decision (proposed):** activation order is **(1) Shows fee → (2) Artist
  Pro + generation credits → (3) marketplace take-rate (same release as 2) →
  (4) Listener Pro ($9.99/mo incl. ~$5 wallet pre-fund) → (5) B2B/agent
  licensing.** Subscription billing v1 is **Stripe** (fiat); on-chain
  subscriptions are explicitly deferred. Listener Pro launch gate: ~500–1,000
  genuine WAU in wedge communities.
- **Why:** solo-founder bandwidth; lines 1–2 have proven comps and no
  cold-start dependency; line 4 needs community density; line 5 has the
  longest sales cycle. Kill criteria per phase are in the review §4.
- **Consequences:** roadmap docs and issue priorities re-sequenced to match
  (see issue triage 2026-07); "What to Build Next" table in
  `docs/rfc/business-model.md` updated.

---

## Ready-to-file commands

The epic body is maintained at `docs/strategy/business-model-phase0-decisions.md`
(this file). File the epic + six decision issues with:

```bash
cd <repo-root>

gh issue create --title "Epic: Business Model v2 — Phase-0 monetization decisions & activation" \
  --body "Tracks ADR-BM-1…6 from docs/strategy/business-model-phase0-decisions.md and the review docs/strategy/business-model-review-2026-07.md. Deliverables: decided fee numbers reconciled into docs/rfc/business-model.md; Shows fee param before prod deploy; generation-credit billing; payout doctrine; identity policy; sequencing." \
  --label "epic,product,roadmap"

gh issue create --title "ADR-BM-1: Shows campaign platform fee (6% success-only) — fee param in ShowCampaignEscrow before prod deploy" \
  --body "Decision + rationale: docs/strategy/business-model-phase0-decisions.md §ADR-BM-1. Blocking for #1271 go-live. Requires full contract test ladder incl. funds-conservation invariants with fee sink." \
  --label "product,contracts,payments,P0"

gh issue create --title "ADR-BM-2: Marketplace take-rate alignment (10% / 15% micro) — raise StemMarketplaceV2 default from 0.5%" \
  --body "Decision + rationale: docs/strategy/business-model-phase0-decisions.md §ADR-BM-2. Reconcile RFC ↔ StemMarketplaceV2 ↔ x402.config.ts into one canonical fee table." \
  --label "product,contracts,payments,P1"

gh issue create --title "ADR-BM-3: AI generation credits — metered billing at cost + margin" \
  --body "Decision + rationale: docs/strategy/business-model-phase0-decisions.md §ADR-BM-3. Depends on Stable Audio 3 / Gemma license resolution (#1193). Gates Remix Studio GPU paths behind credits." \
  --label "product,AI,payments,P1"

gh issue create --title "ADR-BM-4: Payout doctrine & red lines (85%+ artist, user-centric pre-funded, no yield products)" \
  --body "Decision + rationale: docs/strategy/business-model-phase0-decisions.md §ADR-BM-4. Adds doctrine to docs/rfc/business-model.md; all payout-touching RFCs must state compliance." \
  --label "product,payments,security"

gh issue create --title "ADR-BM-5: Monetization identity policy — human verification for payouts, DDEX AI labeling" \
  --body "Decision + rationale: docs/strategy/business-model-phase0-decisions.md §ADR-BM-5. Feeds #1164 (AI Music Integrity). Wires payout gating to existing verification states." \
  --label "product,AI,content-protection"

gh issue create --title "ADR-BM-6: Revenue-line sequencing & billing stack (Stripe v1)" \
  --body "Decision + rationale: docs/strategy/business-model-phase0-decisions.md §ADR-BM-6. Re-sequences roadmap and issue priorities; updates business-model RFC 'What to Build Next'." \
  --label "product,roadmap"
```
