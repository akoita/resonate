# Vision Sprint 53: Two tracks, one remix

**Status:** 🟡 Approved by the owner and started on 2026-11-03.
**Milestone:** [Vision Sprint 53](https://github.com/akoita/resonate/milestone/51).
Each item is a sub-issue of #1903, so the milestone can close while #1903
stays open.
**Goal:** A Pro creator can put stems from two tracks in one Remix Studio
project. The second track is brought to the first one's tempo, key and bars.
Both artists are checked, paid through their licences and credited.

## Why this theme

- **The owner decided.** [`remix-mashups.md`](../rfc/remix-mashups.md) was
  accepted on 2026-11-03, with every recommendation taken (D1–D5).
- **Its precondition is met.** D1 said to build mashups once #2550 (stem
  export) ships. It merged in Sprint 52 and is on staging (release run 235).
- **Mashups are what #1903 has left.** After this sprint, Remix Studio Pro
  (S6) is complete apart from what the RFC leaves out of scope.

## Scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Foundation | [#2558](https://github.com/akoita/resonate/issues/2558) (S6f-3a of #1903) | Backend. Adds `secondarySourceTrackId`. Project stems can come from source A or B. Eligibility runs per source, and each denial carries a `sourceTrackId`. Adds the `remix-mashup/v1` recipe (stretch 0.75–1.33, Pro gate). Publish and export re-check both sources, and the lineage lists both with `role: lead/secondary` |
| 2 | P0 | User feature | [#2559](https://github.com/akoita/resonate/issues/2559) (S6f-3b of #1903) | Render and preview. B is stretched (pitch kept), key-shifted and placed at its offset on A's grid, then goes through the existing per-stem chain. Stem export includes B's stems. Comes with a parity fixture and a measured preview CPU cost, which is D1's go/no-go |
| 3 | P0 | User feature | [#2560](https://github.com/akoita/resonate/issues/2560) (S6f-3c of #1903) | Studio. An "Add a second track" picker. B's tempo, key (with a suggested shift), offset and downbeat controls. Denials name the source that blocks the action. The release page credits both artists. Updates the guide and the feature page, with a screenshot |

## Decisions applied (from the RFC)

1. **D2: no new consent.** Each artist's existing `remixConsent` covers
   mashups. No "allow mashups" switch until an artist asks for one.
2. **D3: no wait on recursive royalty.** Source artists are paid up front
   through the licences the creator holds on each source. A sold master has a
   single EIP-2981 receiver, the creator, as for single-source remixes.
3. **D4: source A leads.** A sets the grid, structure and bar numbers.
   Swapping the sources means starting a new project.
4. **D5: stretch range 0.75–1.33.** Outside that range the studio says the
   two tracks are too far apart.

## Exit criteria

- All three slices merged, with focused backend and web tests. Includes a
  real-ffmpeg parity fixture showing that B's onsets land on A's bars.
- Preview CPU for two stretched stem sets measured and recorded on S6f-3b,
  with a go/no-go against the #2436 and #2534 budgets.
- Feature page and the in-app Remix guide's Pro level updated in the same PRs.
- Verified on staging after a Release Deployment; milestone closed.

## Not in this sprint

The RFC leaves these out:

- more than two sources
- mapping B's sections onto A's structure blocks
- warp markers
- a per-artist mashup switch
- royalty flow-through (E3, #309, #1431)

These stay gated as before:

- #2367 remix challenges
- #2379
- live charging (#2409)
- buying credits (#1422)

## Revenue line

All three slices are on line 2 (creator tools, Remix Studio Pro), phase 1,
behind the `remix.pro` seam, which allows everyone. They earn on line 3 (the
marketplace take-rate) through the licences a mashup requires on both
sources. There is no fee, price or split change, and ADR-BM-4 is untouched.
