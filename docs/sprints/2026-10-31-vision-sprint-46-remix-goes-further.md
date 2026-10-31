# Vision Sprint 46: Remix goes further, dependencies stay honest

**Status:** ◐ In progress — started 2026-10-31 under the owner's delegated
authority for the night of 2026-10-31 (plan, build and merge until 07:00).
**Milestone:** none created yet (the session could not create milestones);
issues are tracked from this doc.
**Goal:** A remixer can add a build-up into a drop and open a Pro mode with
per-stem mixing controls, free for everyone behind the entitlement seam, and
what CI builds for the contracts is exactly what the gitlinks pin.

## Why this theme

- **Remix Studio is a core surface** (epic #1896) and its next deferred slices
  need no owner decision: build-ups (#1908) are deterministic DSP, and Pro mode
  (#1903) can now sit on the entitlement service shipped in Sprint 44 (#2406)
  with policy `everyone`.
- **Supply-chain honesty.** Dependabot moves contract gitlinks that CI never
  builds (#2423), so a dependency update can look tested when it isn't. Open
  security dependency PRs are waiting.

## Scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P1 | Usability | [#1908](https://github.com/akoita/resonate/issues/1908) | Per-block Build-up (rising high-pass sweep + gain ramp) in preview and render with measured parity; `remix-structure` v2 |
| 2 | P1 | Business value + usability | [#1903](https://github.com/akoita/resonate/issues/1903) (slice 1) | Pro mode toggle gated by `remix.pro` (policy `everyone`), per-stem EQ, compression and pan in preview and render; the rest of #1903 stays open |
| 3 | P1 | Known issue | [#2423](https://github.com/akoita/resonate/issues/2423) | `install-deps.sh` reads every pin from its gitlink; account-abstraction pinned to v0.7 and kept there |
| 4 | P2 | Known issue | Open dependency PRs (#2456, #2450, #2449, #2417) | Green security bumps merged; any that fail are fixed or explained |

## Defaults taken (owner may override in review)

1. **#2423:** CI's current pins become the gitlinks (no OpenZeppelin move in
   this sprint), so contract behaviour and storage layout do not change.
2. **#1903:** shipped as a first slice; automation lanes, beat grid, cue/loop,
   DJ export, stem export and mashups stay open on the issue.

## Exit criteria

- Each item has a merged PR with focused tests green.
- Live charging stays off; no price lands for Pro mode.

## Not in this sprint

- #2378 (needs the legal answer on standing consent).
- #2117 (waits on an upstream Dataform release).

## Revenue line

- **Line 3** (remix, free and deterministic): #1908.
- **Line 2** seam only, no price (ADR-BM-6; any price lands in
  `docs/rfc/business-model.md` first): #1903.
- **Vision-neutral quality:** #2423 and dependency PRs.
