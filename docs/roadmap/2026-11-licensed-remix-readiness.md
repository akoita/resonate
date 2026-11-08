---
title: "Licensed Remix Readiness Roadmap (2026-11)"
status: proposed
owner: "@akoita"
created: "2026-11-08"
related:
  - docs/strategy/licensed-derivatives-2026-11.md
  - docs/strategy/licensed-derivatives-decisions.md
  - docs/features/remix_studio_backlog.md
  - docs/features/remix_studio.md
---

# Licensed Remix Readiness Roadmap (2026-11)

This is the phased plan that implements the proposed
[ADR-LD-1…8](../strategy/licensed-derivatives-decisions.md). The goal is that
when licensed fan remixing becomes mainstream (expected early 2027), Resonate
is already the version artists trust: every remix is consented to song by song,
credits and pays the original visibly, and plays below the original, never over
it.

Nothing here is filed or scheduled yet. Each phase becomes a Vision Sprint plan
once the owner accepts the decisions it depends on. Candidate issues are listed
so they can be filed in one pass, with the `vision:core` label and the revenue
line stated.

## Timeline at a glance

| Phase | Theme | Depends on | Target |
| --- | --- | --- | --- |
| P0 | Fix what is wrong | none | Next sprint; watermark marking before 2026-12-02 |
| P1 | Artists in control | ADR-LD-2, ADR-LD-5 | December 2026 |
| P2 | Originals first, money flows back | ADR-LD-1, 4, 6 (RFC reconciled) | December 2026 to January 2027 |
| P3 | Restyle in one tap | ADR-LD-3, 8 (RFC reconciled) | January 2027 |
| P4 | Say exactly what was done | ADR-LD-7 | Rolling, alongside P1–P3 |
| P5 | On-chain recursion | ADR-LD-1 §4, backlog E3 | 2027 |

P0–P2 are the must-haves before the mainstream launches. P3 is what makes the
first impression. P4 runs in parallel because part of it is a legal deadline.

## P0 — Fix what is wrong

These are defects or doctrine conflicts. They need no new decision.

| Candidate issue | Why | Revenue line |
| --- | --- | --- |
| Replace the hardcoded 70/20/10 split preview with the canonical split from the business-model RFC | The UI contradicts ADR-BM-4 | Line 3 (correctness) |
| A fan's private remix draft must not block the source artist from deleting their release | The artist loses control of their own release | Vision-neutral |
| Cascade consent revocation, source quarantine and release withdrawal to published remixes (hide from discovery, stop new sales, honour sold licences) | Revocation only blocks new work today | Vision-neutral |
| Machine-readable marking on every output path, including audio-conditioned drafts and exports; finish #2574 disclosure and #2575 detection; deploy half resonate-iac#333 | EU Art. 50(2) applies to existing systems from 2026-12-02 | Vision-neutral |

## P1 — Artists in control

| Candidate issue | Decision |
| --- | --- |
| Consent matrix per release and per capability (restyle, AI-assisted, vocal transformation, publish, export, monetize), enforced in eligibility at draft, publish, export and sale; policy version bump | ADR-LD-2 §1, 5 |
| Upload flow: explicit remix choice with presets and nothing pre-selected; mint follows the release choice instead of hardcoding `remixable: true` | ADR-LD-2 §2 |
| One-time "review what's remixable" prompt for existing releases | ADR-LD-2 §3 |
| Notify the source artist when a derivative is published (in-app and email) | ADR-LD-5 §1 |
| "Remixes of my music" inbox: list, feature, hold, take down with reason, counter-notice path | ADR-LD-5 §2, 6 |
| Optional approval before publication (AI-assisted only, or all), with `pending_approval` and `held` states | ADR-LD-5 §3 |
| Publish-time moderation for every publish path, including the stem mix | ADR-LD-5, backlog F3 |

UX polish in this phase:

- The consent screen speaks in outcomes ("Fans can slow it down or make it
  lo-fi", "Fans can use AI to extend it"), and each choice comes with a
  30-second audio example.
- The inbox is the artist's default landing page for remix activity, and its
  counts appear in the artist cockpit.

## P2 — Originals first, money flows back

| Candidate issue | Decision |
| --- | --- |
| Source share on remix licence and remix master sales; off-chain ledger keyed on lineage; payout support for multiple payees | ADR-LD-1 §1–2 |
| Source-share setting per release (30–70%, default 50%) in release settings | ADR-LD-1 §2 |
| Split shown on the remix release page, remix checkout and studio publish step, from one split endpoint | ADR-LD-6 §1, 3 |
| Remix earnings in the artist dashboard, per release and per derivative (#281, backlog F2) | ADR-LD-6 §2 |
| Popularity credit: a share of a derivative's qualified plays counts toward the source | ADR-LD-4 §1 |
| Ranking guard: a derivative never ranks above its source on source-intent surfaces; derivatives capped per session elsewhere; evaluation tests | ADR-LD-4 §2 |
| "Remixes" section on track and release pages, and search grouping under the original | ADR-LD-4 §3–4 |
| Lineage view on remix and original pages (#280) | ADR-LD-4 §3 |

## P3 — Restyle in one tap

| Candidate issue | Decision |
| --- | --- |
| Track-level remix licence ("Remix this song"), with an artist-set price and bundle default, issued by the platform without needing a stem mint; one checkout for card or wallet | ADR-LD-3 |
| Restyle sheet on the now-playing screen and track cards: Vibes plus "Describe it", instant DSP preview of up to 60 s, original credit on screen (#283) | ADR-LD-8 §1–2 |
| Licence gate at save, share, publish and export, with "Edit more" that opens the studio with the same settings | ADR-LD-8 §3 |
| Shareable restyle link that plays the restyle *and* the original, with the "No AI used" or AI category badge | ADR-LD-4, 7, 8 |

UX polish in this phase:

- The time from tapping a track to hearing it restyled is under 2 seconds on a
  mid-range phone.
- Every restyle shows "Original by …" with one tap back to it.
- The badge says "No AI used" for DSP restyles. That is the honest answer to
  AI fatigue.
- Empty states explain why a track can't be restyled ("This artist hasn't
  opened restyles") without nagging the artist.

## P4 — Say exactly what was done

| Candidate issue | Decision |
| --- | --- |
| Disclosure in five categories (vocals, instrumentation, composition, post-production, lyrics: none / assisted / generated), mapped to the industry AI-disclosure standard in exports and feeds | ADR-LD-7 §1 |
| One disclosure badge component on cards, in the player and on release pages | ADR-LD-7 §2 |
| Provenance manifest alongside the watermark for exported files | ADR-LD-7 §3 |
| Refuse prompts that name a real artist's style or voice, with a clear message | ADR-LD-7 §5 |

## P5 — On-chain recursion

Backlog E3 (#1431) and recursive royalties (#309): License NFT metadata, the
ancestry tracker, and on-chain splits that replace the off-chain source-share
ledger from P2. The web mint flow sends real `parentIds`.

## Measures of success

- Share of catalogue releases with an explicit remix choice (target: 100% of
  new uploads, and over 50% of existing releases reviewed within 30 days of P1).
- Source share paid per month, and the percentage of derivative revenue that
  reached source artists (target: never below the configured share).
- Click-through from derivative to original (target: at least 15% of derivative
  plays lead to an original play in the same session).
- Original plays per artist before and after their first remixes, as a
  cannibalization check.
- Restyle preview to licence conversion (P3).
- Takedown and hold rates, and the time it takes to resolve them.

## Out of scope

- Artist voice or likeness modes, and covers in the style of a named artist.
- A flat all-you-can-remix subscription paid out of a pool.
- Studio experience and Pro features. They are planned separately in the
  [Remix Studio experience plan](2026-11-remix-studio-experience.md).
