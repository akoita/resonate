# Listening session controls — #1724, #1721, #1723

Vision-neutral listener UX. One branch and PR; do not merge.

## Implementation

1. Queue snapshots: add explicit persisted provenance to `playerContext.tsx` and
   `localLibrary.ts`; pass source playlist identity from playlist entry points.
   Add a queue-save component using existing playlist storage, folder and private
   defaults. Create ordered snapshots atomically; validate supported IDs and
   require explicit confirmation for omissions. Preserve playback on every path.
   Extend backend playlist creation with validated queue-origin context and use
   the domain creation event exclusively for authenticated saves.
2. A–B loops: isolate pure range validation in a player helper, expose shared
   context actions and accessible numeric/time controls. Seek outside the range
   clamps to it; crossing B seeks to A; track changes clear it. No loop-pass
   analytics or reset of qualifying-play state.
3. Finite repeats: a shared explicit plan with configured/remaining counts.
   Natural ends alone consume repeats. Manual track changes cancel track plans;
   replacement/clear cancels queue plans. Shuffle wraps consume exactly one queue
   cycle. Segment loops take priority without consuming finite repeats.
4. Add canonical analytics names, payload validation and tests. Signed-out
   interactions retain existing no-upload behavior. Update player feature docs,
   catalog, User Guide and screenshot.

## Validation and review

Focused pure/helper and component tests; full frontend Vitest for shared player
state; frontend lint/type/build; backend analytics unit/HTTP tests and playlist
Testcontainers integration; browser playback/queue scenarios and help capture.
Run `git diff --check`, review change-impact checklist and diff-scoped security
review. Reconcile issue acceptance, commit, push and create a draft PR with all
three closing references. No merge or ready-to-merge label.

## Risks

Shared playback refs must update synchronously; preserve navigation vs queue
replacement distinction. Do not silently save partial playlists, infer source
identity by coincidental contents, double-count creation events, or count A–B
iterations as completed tracks. All features must be complete before claiming
issue closure; staging verification remains a milestone exit after deployment.


## Completion record

Implemented all three slices, including global/private/public playlist source
entry points, atomic authenticated saves and signed-out metadata persistence,
explicit confirmation of local or server-rejected tracks, range highlights,
and track/queue repeat plans with navigation-safe state. Added the six canonical
control events and preserved the single server creation event for queue saves.

Verified: full frontend Vitest (1,019 tests); frontend lint (no errors; existing
warnings); backend typecheck; four analytics suites (55 tests); playlist
Testcontainers integration (13 tests); seven browser scenarios across desktop
and mobile, with the retry case rerun after structured invalid-track handling.
Production build and final retry check are recorded in the PR validation.

Security review covered the changed playlist/API/analytics trust boundaries,
folder ownership, catalog visibility, event privacy and failure behavior.
Restricted releases are rejected without creating a playlist; names do not
enter queue creation analytics. No outstanding findings from the scoped review.

The PR must remain unmerged. Combined staging verification remains the milestone
exit after deployment; local browser checks use controlled audio and mock auth.
No pricing, payout, schema, dependency or deployment changes are included.
