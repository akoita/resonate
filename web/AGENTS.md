# Resonate Web — UI and User Guide Standards

> Loaded when working under `web/`. Project-wide rules live in the root
> `AGENTS.md`.

## Browser configuration

- Only values safe to expose to browsers may use the `NEXT_PUBLIC_` prefix.
- Import shared API/configuration constants from their canonical module; do not
  redeclare environment-derived URLs in individual components.

## User-visible changes

When a change materially adds, changes, exposes, hides, or removes something a
listener, artist, producer, curator, or operator can see or do, update the
matching `/help` article in `src/lib/help/content.ts` in the same branch.

- Write plain-language user guidance without contract names, API routes, or
  database details.
- Keep `keywords`, `appLinks`, `related`, and `status` accurate. Mark partial or
  coming-soon behavior honestly.
- When a public or signed-in screen exists, refresh the relevant image with
  `scripts/capture-help-screenshots.mjs`.
- Run the content-integrity test in `src/lib/help/help.test.ts`; every referenced
  screenshot must exist.
- Pure internal, backend, infrastructure, and refactor changes normally do not
  require a User Guide update.

See `docs/features/user_manual.md` for the full authoring and screenshot guide.

## UI conventions

Use `window.confirm()` sparingly; prefer the shared `ConfirmDialog` component
for consistent user experience.

## Animation and idle-cost budget

People leave Resonate open for hours, so an idle tab must stay cheap (#2436).
Keep the visuals; pay for them on the compositor.

- An `infinite` animation may only animate `transform` and `opacity`. Do not
  loop `box-shadow`, `background-*`, `filter`, `width`/`height`, colors, or
  layout properties: each frame repaints that area, and re-blurs anything with
  `backdrop-filter` above it. Pulse a dot with a scaling, fading ring
  (pseudo-element) instead of a growing `box-shadow`; slide a pre-painted
  gradient layer with `translate` instead of animating `background-position`.
- Never animate an element *inside* an `<svg>`. SVG children are not
  composited, so the whole SVG restyles, lays out, and repaints every frame.
  Make the moving part its own `<svg>` or HTML box and animate that.
- Prefer one long iteration over many short ones for always-on loops: every
  iteration fires an `animationiteration` event that wakes the main thread
  (put several cycles in one set of keyframes, as the Home tuner EQ does).
- Do not loop decoration that cannot be seen (a rotation of concentric
  circles), and hold animations still when the thing they illustrate is
  paused (the player marquee stops with playback).
- Off-screen and hidden-tab loops are held still for you: the root layout
  mounts `IdleAnimationGuard` (`src/lib/idleAnimationGuard.ts`), which marks
  any element running an infinite animation with `data-idle-paused` while it
  is out of view, the tab is hidden, or nobody has touched the page for 20 s
  (any input resumes it). Loops named like loading indicators (`spin`,
  `shimmer`, `skeleton`, `loading`, `progress`) keep running while the user is
  idle, so name a new loading loop that way. Pause a loop for your own reasons with
  CSS (`animation-play-state` or a class), never with `Animation.pause()`,
  which would fight the guard.
- Pollers and countdowns use `registerVisibleInterval` from
  `src/lib/visibleInterval.ts`: they pause, or back off, while the tab is
  hidden and catch up once when it returns. `src/lib/visibleIntervalBudget.test.ts`
  fails on a new bare `setInterval`; its allowlist (task-scoped or
  background-critical timers) may only shrink.
- `prefers-reduced-motion: reduce` is handled globally at the end of
  `src/app/globals.css`. Add an `animation: none !important` opt-out there only
  when a loop's final frame is not a sensible resting state.

`src/styles/animationBudget.test.ts` enforces the first rule: it fails on any
new infinite animation that animates a paint/layout property. Its allowlist is
legacy debt and may only shrink. Measure idle cost with `npm run perf:idle`
(see `docs/engineering/idle-cost-harness.md`).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
