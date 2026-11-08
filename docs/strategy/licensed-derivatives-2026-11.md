---
title: "Licensed Derivatives Review 2026-11"
status: accepted
owner: "@akoita"
created: "2026-11-08"
related:
  - docs/strategy/licensed-derivatives-decisions.md
  - docs/roadmap/2026-11-licensed-remix-readiness.md
  - docs/features/remix_studio.md
  - docs/features/remix_studio_backlog.md
  - docs/rfc/ai-derivative-rights-policy.md
  - docs/rfc/business-model.md
  - docs/strategy/business-model-phase0-decisions.md
---

# Licensed Derivatives Review 2026-11

## Why this review

In 2026, licensed fan remixing moved from a niche idea to an industry plan.
Recorded-music and publishing rightsholders now license consumer products that
let fans restyle real songs (genre, tempo, mood, arrangement) with artist
opt-in. The derivatives are playable inside the service, they are credited to
the original work, and they earn the original artist money. The first
large-scale consumer launches are expected in early 2027, sold as a paid
subscription add-on.

Resonate has built licensed, stem-true remixing since mid-2026 (Remix Studio,
the AI derivative rights policy, mashups, watermarking). Soon, artists and fans
will know what "a licensed remix" means without being taught. This review asks
one question: when that happens, does Resonate look like the serious, artist-first
version of the category? It covers what is strong, what is weak, and what to
change in the roadmap.

ADR-BM-6 revenue lines: **Line 3** (marketplace remix and commercial licences)
and **Line 4** (Listener Pro, pre-funded and user-centric). Phase: Line 3 is
active; Line 4 is behind its launch gate. Payout rules follow ADR-BM-4 without
exception.

## What the market is converging on

These are the principles the emerging consumer products announce. They are
also what artists and fans will now expect from anyone:

1. **Consent.** Only participating artists and songwriters, opt-in, often in two
   steps (opt into AI programmes, then into a specific tool).
2. **Credit.** Every derivative links back to the original, and derivative plays
   count toward the original's chart position.
3. **Compensation.** Derivative plays and sales earn the original artist money
   on top of normal royalties.
4. **Contained output.** Several products allow no export or download and keep
   sharing inside the service.
5. **Disclosure.** AI involvement is disclosed per category (vocals,
   instrumentation, composition, post-production, lyrics) in credits, and
   machine-readable marking of generated audio is now a legal duty in the EU.

These are the open complaints so far:

- **Opaque money.** No published split. Artists cannot see what a derivative
  earns them.
- **Coarse control.** One opt-in switch, usually exercised through a label or
  distributor deal. Artists are asking to *set the fee* and *choose which songs*.
- **Pressure to opt in.** "Voluntary" may become costly to refuse.
- **Cannibalization.** Derivatives may take plays and placement from the
  originals, especially if recommendation systems favour fresh content.
- **AI fatigue.** A visible share of listeners rejects "AI everywhere".
- **Voice and likeness.** "Cover in another artist's voice" is the most legally
  exposed and most criticised feature. Federal digital-replica legislation with
  notice and takedown advanced in 2026.

## Where Resonate is already strong

| Expectation | Resonate today |
| --- | --- |
| Compensation that is visible | Artist ≥85% of every transaction, settled on-chain (ADR-BM-4). Live payout facts on listings. |
| Real consent | Per-stem `remixable` consent plus an artist-wide revocation switch, and verified-human payout gating (ADR-BM-5). |
| Credit | Machine-readable lineage on every remix release (source track, release and stems, mode, grounding, AI disclosure, policy version). Mashups credit both sources. |
| Honest AI labels | Grounding labels that say what was used: stem audio, stems plus AI, audio-conditioned, feature-conditioned, prompt only. The stem mix and the Vibes are pure DSP, with no generative AI. |
| Output you can use | Personal ⊂ Remix ⊂ Commercial licence tiers. The Commercial tier allows export and off-platform use. Stem export, DJ extended export, and minting a remix master as an ownership product. |
| Traceability | Inaudible watermark embedded at render time (#2573). |
| Depth | Remix Pro: grid correction, cues and loops, automation, mashups. |

The mainstream products are criticised on exactly three points: control, money
and honesty. Those are where Resonate's design is strongest.

## Where Resonate is weak

These come from a code audit of `main` at `4105e65` (2026-11-08):

1. **The source artist earns nothing after the first stem sale.** A published
   remix release belongs to the remixer's artist profile. Its plays, popularity
   and sales credit the remixer. A remix master minted for sale pays its
   EIP-2981 royalty to the remixer only. Recursive royalties (backlog E3, #309,
   #1431) are designed but not built, and the mint flow always sends empty
   `parentIds`.
2. **A split preview contradicts the doctrine.** `PayoutSplitPreview` in the
   artist's stem pricing panel hardcodes Artist 70 / Remixer 20 / Platform 10.
   ADR-BM-4 and the canonical RFC require ≥85% to creators.
3. **No "remix this song".** Remix licences are sold per stem. One stem bought
   opens a one-stem studio. A whole-song restyle needs several wallet purchases,
   each followed by an indexer wait. Tracks whose stems were never minted cannot
   be remixed at all.
4. **No restyle where people listen.** The studio's Vibes (slowed + reverb, sped
   up, lo-fi, dreamy, club) and "Describe it" are good, but fans only reach them
   from release, stem, library and player pages after the rights funnel.
   Cards, the mini player and the now-playing screen have no entry point (#283).
5. **Consent is coarse and defaults on.** The artist-wide setting defaults to
   `allowed`, and the main mint flow hardcodes `remixable: true`. The
   per-capability rules in the AI derivative rights policy (AI variation,
   vocals, publish, export, monetize, manual approval) are not implemented.
   Vocal stems can be re-pitched and published without vocal-specific consent.
6. **Artists cannot see or stop what is built on them.** They get no
   notification when a remix is published, and there is no remix inbox, hold or
   approval, or unpublish. Revoking consent or quarantining the source only
   blocks *new* work. A fan's private draft also blocks the artist from deleting
   their own release (`release_has_remixes`).
7. **Originals are not protected in discovery.** Popularity models and search
   ignore lineage. Remix plays help only the remixer, and nothing stops a remix
   from outranking its original. An original has no list of its remixes (#280).
8. **Trust signals are buried.** The AI or stem-based badge appears only in the
   release header, not on cards or in the player. Watermarking runs only once
   the deployment key is provisioned. Audio-conditioned drafts are not marked.
   Disclosure (#2574) and detection (#2575) are open. The EU machine-readable
   marking duty applies to systems already on the market from 2026-12-02.
9. **Publishing has no moderation step.** Prompt-safety checks run only on AI
   generation.
10. **Artists get no remix money view** (#281, backlog F2).

## Strategy

**Position:** *the licensed remix platform artists choose*. Every derivative is
consented to per song and per capability, credits and pays the original
visibly, and plays below the original, never over it.

### Principles

1. **Originals first.** A derivative must drive listeners to its original and
   never take the original's place. This is a product rule backed by numbers,
   not a slogan.
2. **The artist sets the terms.** The artist chooses the songs, the
   capabilities and the price. Platform defaults exist only to make the choice
   easy, never to make it for them.
3. **Money you can see.** Every remix surface shows who earns what before
   anyone pays or publishes.
4. **Say exactly what was done.** "No AI used" is a claim we can make for DSP
   restyles. When AI was used, the label says which part.
5. **One tap to hear, one licence to keep.** Hearing a restyle is instant and
   free. Saving, sharing, publishing or exporting it requires the right licence,
   bought in one checkout.
6. **No voice, no impersonation.** Artist voice and likeness, and
   "in the style of <named artist>" generation, stay off.
7. **Open, not walled.** Licensed output can leave Resonate when the licence
   says so. This is part of the value, not a leak.
8. **No pools.** Fan-side money stays pre-funded and user-centric (ADR-BM-4).
   There is no all-you-can-remix pool paid out pro rata.

### What we will not do

- A flat subscription that pays derivatives out of a shared pool.
- Voice cloning or style-of-artist covers, even with partial consent.
- A race on feature count. The studio's engine is deep enough. Studio work
  goes into making it fun for amateurs and complete-yet-beautiful for pros
  (see the [Remix Studio experience plan](../roadmap/2026-11-remix-studio-experience.md)).
  The licensing gaps are money, control, discovery and the entry path.
- Naming or benchmarking other services in public product docs. Describe
  market expectations generically.

## Decisions and roadmap

- Proposed decisions: [Licensed Derivatives Decisions (ADR-LD-1…8)](licensed-derivatives-decisions.md).
- Phased plan: [Licensed remix readiness roadmap](../roadmap/2026-11-licensed-remix-readiness.md).
- Backlog: Workstream G in the [Remix Studio backlog](../features/remix_studio_backlog.md).

Target: phases P0–P2 (fix what is wrong, artists in control, originals first
with money flowing back) land before the expected early-2027 mainstream
launches. That way, the first wave of artists comparing options finds a
serious alternative.

## Owner decisions (2026-11-08)

The owner chose the recommended answer to each open question:

1. **Default source share** (ADR-LD-1): 50% of the creators' portion of a
   derivative sale, which the source artist can set between 30% and 70% per
   release. Mashups split it by time used, with a 20% floor per source.
2. **Consent for new uploads** (ADR-LD-2): an explicit choice at upload with
   nothing pre-selected. Existing releases keep their state and get a one-time
   review prompt.
3. **Free preview** (ADR-LD-8): a free, private, preview-only DSP restyle of up
   to 60 seconds, never saved, shared or exported. A licence is needed to save,
   share, publish or export.
4. **Approval scope** (ADR-LD-5): per release, the artist may require approval
   for AI-assisted derivatives only, or for all. AI-assisted only is the
   suggested default when approval is turned on.
