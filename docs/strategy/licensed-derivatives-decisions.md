---
title: "Licensed Derivatives Decisions (ADR-LD-1…8)"
status: accepted
owner: "@akoita"
created: "2026-11-08"
related:
  - docs/strategy/licensed-derivatives-2026-11.md
  - docs/roadmap/2026-11-licensed-remix-readiness.md
  - docs/rfc/ai-derivative-rights-policy.md
  - docs/rfc/business-model.md
  - docs/strategy/business-model-phase0-decisions.md
  - docs/strategy/taste-engine-decisions.md
---

# Licensed Derivatives Decisions (ADR-LD-1…8)

Eight ADR-style decisions that turn the
[Licensed Derivatives Review](licensed-derivatives-2026-11.md) into binding
rules for Remix Studio, publishing, discovery and payouts.

Decision status legend: **proposed** → accepted when the owner confirms it
(on the decision issue or in the project thread). On 2026-11-08 the owner
accepted the recommended answers to the four open questions, which accepts
ADR-LD-1, ADR-LD-2, ADR-LD-5 and ADR-LD-8. The owner accepted ADR-LD-3, 4, 6
and 7 by merging this document the same day (PR #2588). ADR-LD-3 introduces a
price: its pricing must be reconciled into the RFC before code ships. An accepted decision that changes a fee, a split or a price
(ADR-LD-1, ADR-LD-3) must then be reconciled into
[`docs/rfc/business-model.md`](../rfc/business-model.md), the canonical source,
before any code ships. Until then, nothing in this file changes a live number.

Every decision here complies with ADR-BM-4: creators receive ≥85% of each
transaction, there is no pool, there are no thresholds, fan-side money is
pre-funded and user-centric, and there are no royalty-yield products.

ADR-BM-6 revenue lines: Line 3 (marketplace remix and commercial licences) for
ADR-LD-1, 3 and 8. Line 4 (Listener Pro) for the allowance part of ADR-LD-8.
The others are vision-neutral trust and quality infrastructure.

---

## ADR-LD-1 — The original earns from every derivative

> **Status: ACCEPTED — 2026-11-08, confirmed by @akoita** (owner chose the
> recommended defaults in the project thread). Revenue line 3. The source-share
> rule is reconciled into `docs/rfc/business-model.md` §5d. Not yet built.

- **Decision (accepted):**
  1. Every sale of a derivative carries a **source share** for the source
     artist(s): a remix licence, a remix master ownership product, or a remix
     purchase by an agent. The source share is paid out of the creators' ≥85%,
     never out of the platform fee, and never lowers the creators' total below
     85%.
  2. **Default source share: 50% of the creators' portion**, which the source
     artist may set between **30% and 70%** per release. Mashups divide the
     source share between their sources in proportion to the time each source
     is used, with a floor of 20% per source.
  3. When Listener Pro launches, a listener's pre-funded allowance that goes to
     a derivative play is split the same way, user-centric and per listener.
     There is never a shared pool.
  4. Recursion: a derivative of a derivative pays each ancestor along the
     lineage chain with a diminishing share (#309). Until the on-chain ancestry
     work (backlog E3, #1431) ships, the source share is settled from an
     auditable off-chain ledger keyed on the published lineage, and moved
     on-chain afterwards.
- **Why:** "the original artist gets paid" is the headline expectation of the
  category. Today Resonate pays the source artist only on the first stem sale.
  Anything after that pays the remixer only.
- **Consequences:** a source-share field on the remix release and its master.
  Payout and ledger support for multiple payees. The split is displayed per
  ADR-LD-6. The hardcoded 70/20/10 split preview is replaced by the canonical
  numbers.

## ADR-LD-2 — Consent per song and per capability, chosen explicitly

> **Status: ACCEPTED — 2026-11-08, confirmed by @akoita** (explicit choice at
> upload, as recommended). Vision-neutral trust infrastructure. Not yet built.

- **Decision (accepted):**
  1. Remix consent is set **per release** (with a per-track override). It is
     broken into capabilities:
     - **Restyle (DSP):** tempo, key, filters, Vibes, stem mix
     - **AI-assisted:** variation, extension, reimagine
     - **Vocal transformation:** re-pitch, chop or re-time the vocal stem
     - **Publish on Resonate**
     - **Export**
     - **Monetize:** sell the derivative or its master
  2. **New uploads require an explicit choice** with nothing pre-selected. The
     upload flow offers three presets ("Not remixable", "Restyles only",
     "Open to licensed remixes") plus "Custom". The mint flow stops hardcoding
     `remixable: true`; on-chain `remixable` follows the release choice.
  3. **Existing releases keep their current effective state.** The artist sees
     a one-time review prompt that shows exactly what is allowed today.
  4. The artist-wide switch remains a global revocation override.
  5. Vocal transformation is **off unless chosen**, even when "Open to licensed
     remixes" is picked. Stem consent is not vocal consent.
- **Why:** artists are asking to choose which songs, and how. One switch that
  defaults to on reads as pressure. The AI derivative rights policy already
  specifies this matrix, but it is not implemented.
- **Consequences:** a consent model per release and capability in eligibility.
  The policy version is bumped. Every capability is enforced server-side at
  draft, publish, export and sale.

## ADR-LD-3 — "Remix this song": one licence, one checkout, an artist-set price

> **Status: ACCEPTED — 2026-11-08, by @akoita (merge of PR #2588).** Not yet built. Revenue line 3. Introduces a price, so the RFC must be
> reconciled first.

- **Decision (accepted):**
  1. Add a **track-level remix licence** that covers every stem of the track the
     artist made remixable, at the tier bought (Personal, Remix or Commercial).
  2. **The artist sets the price per release.** The suggested default is the
     sum of the stem prices with a bundle discount the artist can adjust.
  3. It is a platform-native licence. **It does not require the artist to mint
     stem NFTs.** Minting stays available for ownership products and the
     on-chain marketplace.
  4. One checkout for card or wallet, with an immediate licence receipt. No
     indexer wait blocks the studio for a licence issued by the platform.
  5. The per-stem licence stays for producers who want single stems.
- **Why:** the per-stem funnel turns "restyle this song" into several purchases.
  It also makes most of the catalogue unremixable unless stems were minted.
- **Consequences:** a new licence type in eligibility and receipts. Pricing
  controls in the artist's release settings. The platform fee is the Remix tier
  take-rate in the canonical RFC.

## ADR-LD-4 — Originals first in discovery

> **Status: ACCEPTED — 2026-11-08, by @akoita (merge of PR #2588).** Not yet built. Vision-neutral; extends ADR-TE-2 recommendation rules.

- **Decision (accepted):**
  1. **Popularity credit.** A share of each derivative's qualified plays (50% by
     default) also counts toward the source track's popularity and chart
     signals. The derivative keeps its own count.
  2. **Ranking guard.** On surfaces where the intent is the source (the source
     artist's page, a search that matches the source, "more like this" from
     the source), a derivative never ranks above its original. On general
     surfaces, derivatives are capped per session and per source.
  3. **Two-way links.** Every derivative shows "Original by …" with a play
     action. Every original lists its derivatives: a "Remixes" section on track
     and release pages, filtered to published and still-eligible ones.
  4. **Search.** Searching for the source artist or title also finds
     derivatives, but groups them under the original.
- **Why:** cannibalization is the second-biggest fear about derivatives. A
  derivative should be a funnel back to the original.
- **Consequences:** lineage joins in the popularity models and in search. A
  derivatives query on the catalog API. Ranking-guard tests in the
  recommendation evaluation.

## ADR-LD-5 — Artists see and control what is built on them

> **Status: ACCEPTED — 2026-11-08, confirmed by @akoita** (approval scope as
> recommended: per release, AI-assisted only or all, AI-assisted only being the
> suggested default when approval is on). Vision-neutral trust infrastructure.
> Not yet built.

- **Decision (accepted):**
  1. **Notify** the source artist when a derivative of their work is published.
  2. Add a **"Remixes of my music" inbox** that lists every published derivative
     with its plays, sales and source share, plus actions: feature, hold
     (hidden pending review), and take down with a reason.
  3. **Optional approval.** Per release, the artist may require approval before
     a derivative goes public, either for AI-assisted derivatives only (the
     suggested default when approval is on) or for all of them.
  4. **Cascade.** Revoking consent, quarantining the source or withdrawing the
     release hides the affected derivatives from discovery and stops new sales.
     Licences already sold remain honoured according to their terms.
  5. **Only published derivatives block release deletion.** A fan's private
     draft never does; it loses its source when the release goes.
  6. A takedown has a counter-notice path with a waiting period and a written
     reason, in line with emerging digital-replica notice-and-takedown rules.
- **Why:** today, artists cannot see, hold or remove derivatives. A fan's
  private draft can also block an artist from deleting their own release.
- **Consequences:** remix publication states (`pending_approval`, `held`,
  `taken_down`), notification types, an artist inbox page, and cascade
  handlers on consent, quarantine and withdrawal events.

## ADR-LD-6 — Money you can see

> **Status: ACCEPTED — 2026-11-08, by @akoita (merge of PR #2588).** Not yet built. Vision-neutral; implements ADR-BM-4 visibility.

- **Decision (accepted):**
  1. Every remix release page, remix licence checkout and the studio's publish
     step shows the split in plain numbers, for example "Of $4.00: original
     artist $1.70, remixer $1.70, Resonate $0.60". The numbers come from the
     canonical RFC, never from constants in the UI.
  2. The artist's dashboard shows remix earnings over time per release and per
     derivative (#281, backlog F2).
  3. Receipts carry the source share and the lineage reference.
- **Why:** an undisclosed split is the main criticism of the category. We can
  disclose ours.
- **Consequences:** one split-description endpoint shared by all surfaces. The
  hardcoded `PayoutSplitPreview` constants are removed.

## ADR-LD-7 — Say exactly what was done, and make it provable

> **Status: ACCEPTED — 2026-11-08, by @akoita (merge of PR #2588).** Not yet built. Vision-neutral; extends ADR-BM-5 and the watermarking
> RFC.

- **Decision (accepted):**
  1. **Disclosure in five categories** on every derivative: vocals,
     instrumentation, composition, post-production and lyrics. Each is marked
     *none*, *assisted* or *generated*, aligned with the industry AI-disclosure
     standard. DSP-only restyles say **"No AI used"**.
  2. The disclosure badge is shown on cards, in the player and on the release
     page, not only in the release header.
  3. **Machine-readable marking on every output path**, including
     audio-conditioned drafts and exports, before 2026-12-02 (EU AI Act
     Art. 50(2) transition end). That means a watermark plus a provenance
     manifest.
  4. Detection is available to operators, and later to artists, for files found
     off-platform (#2575).
  5. **Voice and likeness stay off** (`voiceLikenessAllowed: false`). Prompts
     that name a real artist's style or voice are refused.
- **Why:** honest labels are a differentiator, and machine-readable marking is
  now a legal duty in the EU.
- **Consequences:** the disclosure model is extended from one level to five
  categories. The badge component is reused across surfaces. The watermark is
  deployed (resonate-iac#333) and its gaps closed.

## ADR-LD-8 — Restyle in one tap, licence to keep

> **Status: ACCEPTED — 2026-11-08, confirmed by @akoita** (free, private,
> preview-only restyle of up to 60 s; licence to keep, as recommended).
> Revenue lines 3 and 4. Not yet built.

- **Decision (accepted):**
  1. Add a **Restyle** sheet on the now-playing screen and on track cards for
     tracks whose release allows the Restyle capability. It applies one of the
     existing Vibes (or a "Describe it" sentence) and plays the result
     instantly with the original's credit. It uses DSP only, with no
     generation cost. The one-tap restyle works on the **full mix** (speed,
     key, tone, space, warmth, song shape), consistent with ADR-TE-3: stems
     stay a studio and pro asset, and listeners never hear separation
     artifacts. Stem-level moves (instrumental, drums off) start at "Edit
     more" in the studio.
  2. **Hearing is free and private**: a preview of up to 60 seconds that is
     never saved, shared or exported.
  3. **Keeping needs a licence.** Saving to the library, sharing a link,
     publishing or exporting requires the track-level licence (ADR-LD-3) at the
     matching tier. "Edit more" opens the full studio with the same settings.
  4. Listener Pro (when it launches) may include a monthly restyle allowance
     funded from the listener's own pre-fund. Each restyle's licence is paid
     user-centrically to the artists restyled. There is no pool.
  5. AI-assisted restyles (Reimagine) stay in the studio behind generation
     credits (ADR-BM-3).
- **Why:** the category will be judged on its first tap. Resonate's studio is
  deep, but fans reach it only through a rights funnel.
- **Consequences:** a Restyle entry point (#283), a preview-only mode in the
  audio engine, and a licence gate at save, share, publish and export.
