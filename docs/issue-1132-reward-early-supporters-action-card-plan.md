# Issue #1132 Reward Early Supporters Action Card Slice

## Scope

This slice extends the deterministic artist action cockpit with a
`reward_early_supporters` card. The first implementation uses existing
artist-attributed analytics facts only:

- primary signal: `community.role_granted` with `roleType=supporter`;
- fallback signal: `community.campaign_room_joined` for
  `show_campaign_supporter` rooms when supporter role grants are absent.

The card appears only after the standard artist action threshold is met.

## Product Boundary

- The card deep-links to the existing artist community tab, where artists can
  create or refresh supporter benefits manually.
- The recommendation is advisory only; it does not auto-send benefits,
  messages, payouts, or campaign updates.
- Inputs remain aggregate-only or artist-owned. The card does not expose
  supporter identities, wallet addresses, raw ownership proofs, private support
  history, or individual room membership.
- Badge grants are intentionally not counted in this slice to avoid
  double-counting the same campaign supporter when both a supporter badge and
  role are granted.

## Verification

- Backend analytics tests cover thresholded card creation from supporter role
  grants and fallback behavior from supporter-room joins.
- Frontend dashboard rendering tests cover the new card title and CTA through
  the generic action-card UI.
- Feature docs must list the card, threshold, route, privacy boundary, and
  deferred work.

## Deferred

- Auto-creating or auto-sending rewards.
- Model-backed prioritization or copy generation.
- Per-supporter drilldowns from artist analytics.
- Current-state reads from supporter benefit rules.
- Rich reward workflows beyond the existing benefit-rule/community surfaces.
