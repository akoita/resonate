# Vision Sprint 56: Marked and honest remixes

**Status:** 🟡 Proposed on 2026-11-09. The three defect fixes are in review;
the plan waits for the owner's approval.
**Milestone:** [Vision Sprint 56: Marked and honest remixes](https://github.com/akoita/resonate/milestone/54).
Issues also carry the `sprint:vision-56` label and are sub-issues of epic #2589.
**Goal:** By 2026-12-02, every piece of generated audio that leaves Resonate
carries a machine-readable mark, and the three places where the product
contradicts its own remix rules are fixed: the split an artist is shown, an
artist's control over deleting their own release, and what happens to
published remixes when the artist says stop.

## Why this theme

- **A date we don't choose.** Machine-readable marking of generated audio
  applies to systems already on the market from 2026-12-02 (EU AI Act
  Art. 50(2); to be confirmed by a lawyer). Sprint 54 shipped the embed step
  (#2573). The remaining paths, the disclosure and the detector are still
  open, and the key has to be in place wherever the feature runs.
- **Phase P0 of the readiness roadmap.** The
  [licensed remix readiness roadmap](../roadmap/2026-11-licensed-remix-readiness.md)
  starts with "fix what is wrong": defects and doctrine conflicts that need
  no new decision. ADR-LD-1…8 were accepted on 2026-11-08 and none is built.
  Nothing in P1 or P2 is credible while the pricing panel shows a split that
  breaks ADR-BM-4.
- **Small and checkable.** Each item is one PR with tests. No owner decision
  blocks any of them.

## Scope and order

The marking work comes first because it has the deadline. The three defect
fixes are independent of it and of each other.

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Compliance | [#2574](https://github.com/akoita/resonate/issues/2574) (carried in Sprint 54) | Licence text, the export panel and the Remix guide say renders carry an inaudible mark that identifies the project |
| 2 | P0 | Compliance | [#2602](https://github.com/akoita/resonate/issues/2602) Marking on every generated-audio output path | Audio-conditioned drafts and AI part takes are marked. A render that contains generated audio never ships unmarked when a key is configured (the DSP-only path stays fail-open). The published file is proven to keep its mark. One inventory of output paths in the feature page, enforced by a test |
| 3 | P0 | Compliance | [#2575](https://github.com/akoita/resonate/issues/2575) (carried in Sprint 54) | Admin-only detection with active and retired keys, attached to disputes as evidence |
| 4 | P0 | Doctrine | [#2599](https://github.com/akoita/resonate/issues/2599) Canonical split preview | The stem pricing panel shows the real split per licence tier from the server's fee, never a constant. No "Mixer / Remixer" slice. A test fails below 85% for the artist |
| 5 | P0 | Trust | [#2600](https://github.com/akoita/resonate/issues/2600) Private drafts must not block release deletion | Only published derivatives block deletion (ADR-LD-5 §5). Unpublished drafts go with the release and their creators are told |
| 6 | P0 | Trust | [#2601](https://github.com/akoita/resonate/issues/2601) Consent revocation reaches published remixes | Revoking consent, withdrawing the source or holding it puts published derivatives on a source hold: out of discovery, no new sales, sold licences honoured (ADR-LD-5 §4). The hold lifts when the cause does |
| 7 | P1 | Trust | Candidate, filed when the P0s land: notify the source artist when a derivative is published | ADR-LD-5 §1, the first slice of the P1 inbox |

**Deployment half:** the watermark key and tooling are tracked in the private
infrastructure repository (resonate-iac#333). The operator writes the secret.
Items 1–3 only take effect where that is done, so it has the same deadline.

**Sprint 54 stays open** for #2566 and #2576. Items 1 and 3 keep their
Sprint 54 milestone; they are listed here because this sprint's goal depends
on them.

## Owner decisions

1. **Unmarked generated audio.** Recommended: when a key is configured and
   embedding fails on a render that contains generated audio, block export
   and publish with a clear message, and keep the free DSP-only path
   fail-open (#2602, gap 3).
2. **What happens to a fan's draft when its source release is deleted.**
   Recommended and built in #2600: the draft is removed and the creator is
   told. Keeping a shell with no source needs a schema change across the
   remix service and can follow if creators ask for it.
3. **Legal check.** Recommended: a lawyer confirms the Art. 50(2) date and
   that an inaudible watermark plus the metadata disclosure meets
   "machine-readable" for our outputs.

## Exit criteria

- #2574, #2575 and #2602 merged, with the inventory of output paths in
  `docs/features/remix_studio.md`.
- #2599, #2600 and #2601 merged with tests, and the User Guide updated where
  behaviour changed.
- The deployment half done before 2026-12-02, recorded in the private
  repository.
- Epic #2589 P0 checklist ticked.

## Not in this sprint

- The consent matrix, the upload choice and the artist inbox (roadmap P1).
- The source share on derivative sales and the split on remix pages
  (roadmap P2; ADR-LD-1, ADR-LD-6).
- Track-level licences and one-tap Restyle (roadmap P3). ADR-LD-3 pricing
  must be reconciled into the business-model RFC first.

## Revenue line

ADR-BM-6: #2599 is Line 3 (marketplace remix and commercial licences),
correctness only. Everything else is vision-neutral trust and provenance
infrastructure. No fee, price, split or payout changes. ADR-BM-4 is
untouched, and #2599 makes the UI state the ≥85% that is already paid.
