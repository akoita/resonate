# Issue #1121 Holder Benefit Action Card Slice

## Scope

This slice extends the deterministic artist action cockpit with a
`create_holder_benefit` card. The card appears when aggregate holder-room joins
meet the artist action threshold and the selected analytics window has no
`community.benefit_rule_created` signal.

## Product Boundary

- The card deep-links to the existing artist community tab benefit-rule manager.
- The recommendation is advisory only; it does not auto-create or draft a
  benefit rule.
- Inputs remain aggregate-only or artist-owned. The card does not expose holder
  identities, wallet addresses, private proof details, or individual room
  membership.
- Existing `invite_holder_collectors` guidance remains available for holder-room
  engagement. This slice adds a more specific benefit-creation recommendation
  when recent benefit creation is absent from the analytics window.

## Verification

- Backend analytics tests cover thresholded card creation and suppression when a
  benefit-rule creation event is already visible.
- Frontend dashboard rendering tests cover the new card title and CTA through
  the generic action-card UI.
- Feature docs are updated to mark true holder-benefit creation guidance as
  implemented while keeping broader P7 recommendation work tracked in #1121.

## Deferred

- Model-backed prioritization or copy generation.
- Automatic benefit-rule creation.
- Cross-window current-state reads from the community benefit-rule table.
- Public holder-benefit showcase badges on profiles.
