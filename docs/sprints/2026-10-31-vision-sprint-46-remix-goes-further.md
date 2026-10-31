# Vision Sprint 46: Remix goes further, dependencies stay honest

**Status:** ✅ Closed 2026-10-31. All four items have merged PRs. #1903 stays
open for its remaining slices.
**Milestone:** none created yet (the session could not create milestones);
issues are tracked from this doc.
**Goal:** A remixer can add a build-up into a drop and open a Pro mode with
per-stem mixing controls, free for everyone behind the entitlement seam, and
what CI builds for the contracts is exactly what the gitlinks pin.

## Outcome

| Issue | Result | PR |
| --- | --- | --- |
| #1908 | Any structure block can be a Build-up: a rising high-pass sweep (30 Hz to 1.5 kHz) and a gain ramp into the next block, in the preview and the render, with measured parity. `remix-structure/v2` is stored only when a build-up exists, so existing recipes are unchanged | #2484 |
| #1903 (slice) | Per-block EQ and pan had already shipped (S6a, #1940), so this sprint shipped S6b: a per-stem Punch compressor in `remix-fx/v4`, ffmpeg `acompressor` in the render and a faithful AudioWorklet port in the preview, pinned by a live-ffmpeg fixture. Behind `remix.pro` with policy `everyone` | #2481 |
| #2423 | Every contract gitlink is the pin CI builds; `install-deps.sh` reads them from the gitlinks | #2477 |
| Dependencies | Electron 42.11.16 (#2456). multer and qs patched in the backend with an override instead of a NestJS major (#2476, replacing #2450). #2449 and #2417 were superseded and closed | #2456, #2476 |

**Unplanned:** a flaky admin step-up test (the tampered MAC was sometimes
unchanged because of base64url padding bits) was fixed in #2486.

**Carry-over:**

- #1903 stays open for S6c grid correction, S6d cue and loop points with the
  DJ export, S6e automation lanes, and S6f stem export and mashups.
- The multer override in `backend/package.json` should go once NestJS ships a
  release that depends on the patched multer.
- Build-ups use one fixed curve; per-block depth or shape and automatic
  build-ups are not planned yet.

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
