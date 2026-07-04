---
title: "Business Model Review — July 2026"
status: proposed
owner: "@akoita"
created: "2026-07-04"
source_context:
  - docs/rfc/business-model.md
  - docs/rfc/rights-verification-strategy.md
  - docs/rfc/licensing-roadmap.md
  - docs/rfc/stablecoin-payment-architecture.md
  - docs/strategy/next_generation_music_platform_analysis.md
  - docs/roadmap/2026-07-shows-to-prod.md
related:
  - docs/strategy/business-model-phase0-decisions.md
  - docs/strategy/business-model-unit-economics-2026-07.xlsx
---

# Resonate Business Model Review — July 2026

> **TL;DR** — The strategic model in [business-model.md](../rfc/business-model.md)
> ("Listen → Signal → License") is sound and now empirically validated by
> external data: do not compete with Spotify on streaming. The real problem is
> not indecision about the model — it is that **zero revenue lines are switched
> on**, fee numbers contradict each other across docs and contracts, and four
> revenue engines are carried simultaneously by a solo founder. The fix is
> sequencing: activate **Shows campaign fees** and **creator tool
> subscriptions** first, keep listener subscription and agent commerce for
> later, and adopt one payout doctrine — *pre-funded, user-centric, 85%+ to the
> artist* — which is both fairer than Spotify's pool and structurally immune to
> the AI-fraud epidemic eating pro-rata streaming.

**Positioning sentence:**

> **Resonate is the direct-to-fan and direct-to-creator commerce platform for
> music — streaming is the storefront, ownership and participation are the
> products, and artists keep 85%+.**

---

## 1. Current state: designed, built, but not earning

### 1.1 What is genuinely decided and good

- [business-model.md](../rfc/business-model.md) has the right core insight
  ("Spotify's economics are brutal… full tracks are the storefront, not the
  product"), four coherent revenue layers, a documented artist split
  (70–90% artist / 10–15% platform), and a real market signal for Shows
  (the NANO touring-risk post).
- [rights-verification-strategy.md](../rfc/rights-verification-strategy.md)
  already answers the distributor/identity question with a progressive-trust
  ladder — open uploads, tiered monetization rights.
- The **rails are ~80% built**: `StemMarketplaceV2`, `RevenueEscrow`,
  `ShowCampaignEscrow` (hardened: fuzz/invariant/formal/Certora/Gambit), x402
  micropayments, ERC-4337 wallets with budget caps, EIP-2981 royalties,
  Remix Studio E1–E2, community holder benefits.

### 1.2 The gap: every revenue line is "documented but not billing"

| Revenue line | Documented price | Rail built? | Actually collecting? |
| --- | --- | --- | --- |
| Marketplace fee | 10–15% (RFC) | ✅ `StemMarketplaceV2` live | ⚠️ Contract default is **0.5%** (max 5%) — contradicts the RFC |
| x402 licenses | Personal $0.05 / Remix $5 / Commercial $25 | ✅ Implemented | Testnet only; prices don't match RFC ($5–50 remix, $50–5,000+ commercial) |
| Pro subscription | $9.99–14.99/mo | ❌ Not started | No |
| Shows campaign fee | "TBD" | ✅ Escrow contract hardened | **No fee parameter exists at all** |
| AI generation | $0.06/30s cost tracked | ✅ Lyria + SA3 workers | Cost displayed, never billed |
| License NFTs / recursive royalties | Designed | 📋 RFC only | No |

The `StemMarketplaceV2` protocol fee of 0.5% versus the RFC's 10% is the
sharpest example — at 0.5%, $1M of marketplace GMV earns the platform $5,000.
That is a configuration decision worth ~20x revenue sitting undecided in a
constructor default.

The second structural issue: **four revenue engines is too many to activate at
once as a solo founder.** Each layer needs billing, pricing pages, support,
fraud handling, and tax. Spotify — with every advantage — took 18 years and
290M subscribers to post its first profitable year (FY2024, €1.14B net income —
MBW/Variety, Feb 2025). Resonate needs an order, not a menu.

---

## 2. Reality check: what the industry data says (researched 2026-07-04)

### 2.1 Why the giants share one model — and why it cannot be ours

Spotify, Apple, Deezer, and Tidal converge on ~$11/mo subscriptions, ~70% of
revenue to rights holders, and pro-rata pool division because **they license
the majors' catalogs and the majors dictate those terms.** At the artist end:

- Independent artists earned a blended **$3.41 per 1,000 streams in 2024**
  ($3.00 on Spotify) — Duetti Music Economics Report, Jan 2025.
- A label-signed artist keeps 10–25% of the label's share of *that*.
- Spotify pays **nothing below 1,000 streams/track/year** (policy live since
  April 2024; Disc Makers estimated ~$47M moved away from small artists in
  2024).
- Spotify's first-ever profitable year was 2024; gross margin ~32–33% is the
  arithmetic complement of the ~70% payout — the model only works at
  290M-subscriber scale.

Resonate does not license major catalogs, so it is not bound by these terms —
and it also cannot win on catalog breadth. Both facts point the same way:
**streaming is the storefront; commerce is the business.**

### 2.2 Where independent-artist money actually flows (the comps)

| Comp | Model | Verified scale (2024–2026) |
| --- | --- | --- |
| **Bandcamp** | 10–15% take on direct sales | **$1.75B paid to artists lifetime**; ~82% of every dollar reaches the artist; one $10 album ≈ **3,000 Spotify streams** |
| **BeatStars** | Seller subscription + commission (beats) | **$400M+ cumulative paid to producers** (MBW, late 2025) |
| **Splice** | $9.99+/mo creator subscription (samples) | ~350M downloads in 2024 |
| **Tracklib** | Subscription + 2–20% royalty share on cleared samples | Only scaled programmatic derivative-rights clearance — validates the stem/remix licensing mechanic |
| **Epidemic Sound** | B2B all-rights licensing subscription | **$181.6M revenue, +29% YoY, EBITDA-positive (audited 2024)** |
| **SoundCloud FPR** | User-centric royalties | 56% of artists earned more than under pro-rata; **superfans = 1.9% of listeners → 42% of revenue** |
| **Patreon** | Patronage | ~$10B lifetime creator payouts; >$2B/yr |

Superfan context: Goldman Sachs sizes superfan monetization at ~$4.3B/yr
(Music in the Air 2025); MIDiA reports "expanded rights" (fan monetization)
grew +21.5% in 2025 — faster than streaming.

**Pattern: artists and producers pay for tools and clean rights; fans pay for
ownership, access, and participation; businesses pay for certainty. Nobody
makes money selling passive streams of a small catalog.**

### 2.3 The web3-music graveyard — final verdicts

Since Resonate began, the 2021–22 cohort resolved: **Sound.xyz shut down
(Jan 2026), Catalog shut down (Mar 2026), Opulous liquidated (2026), Royal's
marketplace sunset (2024)** — all heavily funded (Royal raised $71M and paid
collectors ~$156K in royalties). Survivors pivoted to utility (Audius → USDC
paid content + artist coins), regulated debt (Bolero), or SEC-qualified
non-crypto securities (JKBX, SongVest). Three binding lessons:

1. **Speculation-first dies; utility survives.** Punchline drops and stem
   collectibles must be fan goods with utility (access, credits, holder
   benefits — already built), never investments.
2. **Selling royalty-income shares to fans is a security** (Howey applies
   regardless of the NFT wrapper — Skadden 2025). Shows escrow is safe because
   it is a conditional *purchase* with refunds, not a yield instrument.
   Recursive remix royalties to *creators of derivative works* are fine;
   "fans buy a % of streaming income" is a regulatory trap.
3. **Blockchain must be invisible plumbing** — already Resonate doctrine.

### 2.4 Tidal Upload, distributors, and the identity question

- **Tidal Upload** (Nov 2025) validates direct upload — and proves its hard
  part: uploaded tracks **earn zero royalties** (Tidal's own support page);
  compensation is promo programs ($100/day Spotlight). Tidal dodged
  open-upload-plus-money by removing the money.
- **Spotify** tried direct upload in 2018 and killed it in July 2019 to
  protect distributor/label relations.
- The reason DSPs hide behind distributors is now quantifiable: **44% of all
  daily uploads to Deezer are fully AI-generated (75,000/day, April 2026), and
  ~85% of streams on those tracks are fraudulent**; Spotify purged **75M spam
  tracks** in one year; ~10% of all global streams are fraudulent (~$2B/yr,
  Beatdapp); the first federal conviction for AI streaming fraud (US v.
  Michael Smith, $8M+) is exactly the attack an open platform invites.

**The structural insight none of our docs stated explicitly:**

> **Pro-rata pools are what make streaming fraud profitable. Resonate's
> pre-funded, user-centric wallet model has no pool to drain.** A bot farm on
> Spotify dilutes everyone's royalties; on Resonate a fake listener can only
> spend money someone loaded into that wallet — fraud becomes self-financing,
> i.e., pointless. The only way to reintroduce the vulnerability is to
> subsidize payouts from platform funds (free-tier payouts, listener rewards).
> **Never do that.**

Identity doctrine (extends the existing trust ladder):

- Human verification gates **payout eligibility, not upload** (proof-of-control
  now; optional proof-of-personhood later — no DSP has deployed C2PA or
  proof-of-personhood yet as of mid-2026, so this is an open differentiation
  window).
- AI-generated and AI-assisted work is allowed but **labeled** (align with the
  DDEX AI-disclosure standard Spotify adopted Sept 2025; `ai_generated` release
  type already exists) and routed to a distinct monetization policy — the
  Deezer (excluded from recommendations) and Tidal (royalty-ineligible)
  precedents give industry cover.
- Distributors are never *required* (that is the decentralization value
  proposition) but remain an optional trusted-source fast path, exactly as the
  rights-verification RFC designed.

---

## 3. The recommended model: five revenue lines, ranked by activation order

| # | Revenue line | Comp that proves it | Take | Who pays | When |
| --- | --- | --- | --- | --- | --- |
| 1 | **Shows campaign fee** — % of successfully funded escrow campaigns | Kickstarter (5% + processing) | 5–8%, success-only | Fans (built into pledge) | Now — closest-to-PMF real-money feature |
| 2 | **Artist Pro (creator SaaS)** — stem separation, AI remix credits, analytics cockpit, verification fast-path, campaign tools | DistroKid / Splice / LANDR / BeatStars | ~$15–25/mo + metered generation credits (GPU cost + 30–50% margin) | Artists/producers | Next — artists demonstrably pay for tools |
| 3 | **Marketplace take-rate** — downloads, stems, remix licenses, punchline/moment drops, secondary royalties | Bandcamp / BeatStars / Tracklib | 10% (15% micro-purchases) — raise the 0.5% contract default | Fans & producers | With #2 — rails already live |
| 4 | **Listener Pro** — $9.99/mo with ~$5 pre-funded wallet; user-centric per-play micropayments; stem preview; AI DJ | SoundCloud FPR + Patreon logic | 15% of micro-spend + subscription margin | Superfans | After catalog/community density |
| 5 | **B2B & agent licensing** — commercial/sync tiers, x402/MCP machine-native checkout | Epidemic Sound | 10% of negotiated licenses | Businesses, AI agents | Last — highest value, longest sales cycle; the x402 rails are ahead of the market |

**Listener Pro unit-economics sanity check:** a $5/mo pre-funded wallet at
$0.005–0.01 per play funds 500–1,000 plays/month — 2–3× Spotify's effective
indie rate, paid user-centrically, fraud-proof by construction. It is a
genuinely better artist deal *and* honest math. It is just not the first
dollar, because it needs listeners, and listeners need the catalog and
community that lines 1–3 attract. See the scenario model in
[business-model-unit-economics-2026-07.xlsx](business-model-unit-economics-2026-07.xlsx).

**Payout doctrine (one rule, everywhere):** artist receives **85%+ of every
transaction**, settled in USDC, visible on-chain, no recoupment, no pool, no
thresholds. The artist pitch is one sentence: *"One fan buying one $10 thing
on Resonate pays you more than 2,500 Spotify streams."*

**Beachheads (pick two, refuse everything else for six months):**

- Shows wedge: international niche scenes (already chosen; NANO signal —
  Japanese music abroad, diaspora scenes, underground rap, metal, Afrobeats,
  electronic subcultures).
- Commerce wedge: **francophone rap / Afrobeats producer scene** — hip-hop is
  where punchlines, acapellas, and stems already have liquid market culture
  (BeatStars' $400M was built on it), platform loyalty is weak, and
  founder-market fit is real.

**Red lines (the data says these kill):**

1. No royalty-yield products for fans (securities).
2. No ad-supported tier (no scale to sell).
3. No platform-subsidized payouts on free listening (reopens the fraud
   vector).
4. No catalog-breadth race (loses to Spotify by definition).
5. No launching all five lines at once (loses to the calendar).

**Stakeholder value:**

- *Platform*: two near-term revenue lines with real comps, a defensible moat
  (rights-aware remix + agent-native commerce), no major-label dependency.
- *Artists*: 85%+ economics, price-setting power, direct fan relationships,
  portable on-chain proof of rights, open door without a distributor.
- *Listeners*: free discovery plus what streaming never gave them — ownership,
  participation, and consequence (their pledge books the show; their purchase
  funds the artist directly).

---

## 4. Roadmap

### Phase 0 — Decide and align (July 2026, ~2 weeks, parallel to Shows hardening)

Turn the open questions into committed decisions in the repo — see
[business-model-phase0-decisions.md](business-model-phase0-decisions.md)
(ADR-BM-1 … ADR-BM-6). Output: one updated RFC + decision issues; every fee
number appears in exactly one canonical place.

### Phase 1 — First dollar: Shows (Aug–Sep 2026)

- Finish the hardening gate already planned (#943/#944/#1260, security
  review).
- **Add the campaign fee parameter to `ShowCampaignEscrow` before production
  deploy** (a fee added later is a migration; added now it is a constructor
  arg).
- Execute the gated go-live (#1271) with 3–5 hand-picked campaigns in the
  niche-scene wedge.
- Success metric: 2 funded campaigns, first fee revenue, zero escrow
  incidents. Kill criterion: if <20% of campaigns reach threshold, iterate the
  wedge or tiers before scaling.

### Phase 2 — Artist Pro + metered generation (Oct–Dec 2026)

- Ship subscription billing (Stripe for fiat v1 — no on-chain subscriptions
  yet) bundling stem separation, remix generation credits, the analytics
  action cockpit, and verification fast-path.
- Gate GPU-expensive Remix Studio paths behind credits from day one — costs
  are already displayed honestly; now bill them.
- Raise the marketplace fee in the same release.
- Success metric: 50 paying artists (~$1–1.5k MRR) and marketplace GMV >
  $5k/quarter. This converts the biggest cost center (GPU inference) into a
  margin line.

### Phase 3 — Listener Pro + user-centric micropayments (Q1 2027)

- Wallet, budget caps, and x402 rails exist; add subscription billing + $5
  pre-fund + per-play settlement.
- Market the fraud-proof "your money → your artists" story loudly — the best
  PR asset against the AI-slop-and-fraud news cycle.
- Prerequisite gate: do not launch until weekly active listeners in the wedge
  communities make $5/mo of listening plausible (~500–1,000 genuine WAU).

### Phase 4 — Rights infrastructure at scale (2027)

- LicenseRegistry + AncestryTracker + recursive royalties
  ([licensing roadmap](../rfc/licensing-roadmap.md) Phases 2–3), commercial/
  sync tiers, and the agent/B2B channel (x402/MCP storefront as first-class
  product). Tracklib proves the clearance mechanic, Epidemic proves the B2B
  pricing, and nobody has the agent-native version yet.

### North-star metric

**Median monthly take-home per active artist** — the number that proves "more
economically attractive than Spotify." Guardrails: platform GMV, take-rate
revenue, fraud rate on payouts (must stay ~0 by construction), % of artists at
verified-or-higher trust tier.

---

## 5. Key sources (external research, 2026-07-04)

- Duetti Music Economics Report 2024 (indie per-stream rates) — prnewswire.com, Jan 2025.
- Spotify Loud & Clear 2025/2026; Spotify Q4 2024/2025 earnings (first
  profitable year; margins) — newsroom.spotify.com, MBW, Variety.
- Spotify 1,000-stream threshold — Spotify for Artists (Nov 2023); Disc Makers
  counter-estimate (Apr 2025).
- Deezer AI-upload stats (44% of uploads, ~85% fraudulent streams) —
  newsroom-deezer.com Apr 2026; Deezer AI-tagging (June 2025).
- Spotify 75M spam-track purge + DDEX AI disclosure — newsroom.spotify.com,
  Sept 2025.
- Beatdapp fraud estimates (~10% of streams, ~$2B/yr) — Rolling Stone 2024–25.
- US v. Michael Smith (AI streaming fraud, guilty plea, ~$8M forfeiture) —
  DOJ SDNY.
- Tidal Upload terms (no royalties; Spotlight $100/day) — support.tidal.com,
  MBW, MusicRadar, Nov 2025.
- Spotify direct-upload beta shutdown — Spotify for Artists blog, TechCrunch,
  July 2019.
- Bandcamp $1.75B lifetime, 82% artist share — bandcamp.com/about (fetched
  July 2026); Bandcamp Fridays $154M — MBW Dec 2025.
- BeatStars $400M+ payouts — MBW late 2025. Splice ~350M downloads 2024 — MBW.
- Tracklib subscription clearance + 2–20% royalty share — tracklib.com.
- Epidemic Sound $181.6M revenue 2024 — MBW / annual report.
- SoundCloud fan-powered royalties study (56% earn more; 1.9% superfans → 42%
  of revenue) — Billboard Pro / MIDiA, Mar 2022.
- Goldman Sachs Music in the Air 2023–2025 (superfan $4.3–4.5B; 2025 forecast
  cut) — Music Week, Billboard Pro.
- MIDiA 2025 (expanded rights +21.5%; self-releasing share declining) —
  midiaresearch.com.
- Web3 shutdowns: Sound.xyz (Jan 2026, founder announcement), Catalog
  (fin.catalog.works, Mar 2026), Opulous liquidation (opulous.org, 2026),
  Royal marketplace sunset (Apr 2024); Royal ~$156K royalties vs $71M raised —
  Center for a Digital Future.
- Securities: Howey applies to royalty NFTs — Skadden 2025; SEC-qualified
  survivors JKBX (Reg A), SongVest.
- Audius USDC payments (10% treasury fee, Sept 2024) and Artist Coins
  (Oct 2025) — GlobeNewswire, Music Ally.
