# Idle-cost harness and animation budget

Status: **implemented** (tooling and guardrail) · Audience: frontend developers,
agents doing perf work · Tracking: [#2436](https://github.com/akoita/resonate/issues/2436)

People leave Resonate open for hours, often on a laptop. A tab that nobody is
touching must cost close to nothing: no continuous repaints, no main-thread
churn, and no polling while it is hidden. This page covers the probe that
measures that, the rule that keeps it true, and the #2436 results.

This is engineering tooling and runtime quality work. It changes nothing a
listener or artist can do; the visuals are meant to look the same.

## Run it

```bash
cd web

# Production build (dev-mode numbers are dominated by compilation and HMR):
NEXT_PUBLIC_MOCK_AUTH=true npm run build
npm start -- -p 3001

npm run perf:idle
IDLE_ROUTES=/,/player IDLE_WINDOW_MS=20000 npm run perf:idle
```

Against localhost the probe needs only the web app. It mocks the API offline:
API calls fail fast, so the app falls back to its offline samples (sample show
campaigns), and one mocked track is loaded into the persistent player and left
**paused**, which matches the #2436 report (Home, signed in, player paused).
Set `IDLE_MOCK_API=false` to measure a real backend. The target always comes
from the environment; never edit a deployment URL into the script.

| Variable | Default | Purpose |
| --- | --- | --- |
| `IDLE_BASE_URL` | `BASE_URL`, then `http://localhost:3001` | Origin to measure |
| `IDLE_ROUTES` | `/,/player,/library,/shows` | Routes, visited by client-side navigation so the player stays mounted |
| `IDLE_SETTLE_MS` | `6000` | Quiet time after navigation before measuring |
| `IDLE_WINDOW_MS` | `10000` | Measured idle window |
| `IDLE_MOCK_API` | `true` on localhost | Mock the API offline |
| `IDLE_API_ORIGIN` | `http://localhost:3000` | API origin to mock |
| `IDLE_SIGNED_IN` | `true` | Inject the E2E mock session (`tests/auth.setup.ts`) |
| `IDLE_OUT_DIR` | `web/build/perf` | JSON output (`idle-latest.json`) |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Playwright's | Chromium binary override |

## What it measures

For each route, after the settle time, over the idle window:

- **busy %**: main-thread task time divided by wall time (CDP `Performance.getMetrics`).
- **script ms, style recalcs, layouts**: main-thread work during the window.
- **paints/s and viewports/s**: `Paint` trace events and their area, clamped to
  the viewport. 1.0 viewport/s is one full-viewport repaint every second. This
  is what Rendering → Paint flashing shows by eye.
- **infinite animations**: running `document.getAnimations()` with infinite
  iterations, split into on-screen and off-screen targets.
- **heap**: JS heap used at the start and end of the window.
- **hidden**: requests and timer callbacks while the page reports
  `visibilityState === "hidden"`. The probe overrides the property and fires
  `visibilitychange`, which exercises the app's own guards; the browser's real
  background throttling comes on top and is not simulated.
- **reduced motion**: running infinite animations after emulating
  `prefers-reduced-motion: reduce`.

Headless Chromium rasterizes in software and exposes no GPU process, so the
absolute costs are higher than on a GPU laptop and GPU % is not reported. The
counts and areas carry over. Compare runs only on the same machine and build.

## Animation budget

The rules live in [`web/AGENTS.md`](../../web/AGENTS.md) under "Animation and
idle-cost budget". In short:

- infinite animations move only `transform` and `opacity`;
- nothing animates inside an `<svg>`;
- always-on loops use long iterations, because each `animationiteration` event
  wakes the main thread;
- pollers use `registerVisibleInterval` (`web/src/lib/visibleInterval.ts`);
- `prefers-reduced-motion` is handled globally in `web/src/app/globals.css`.

`web/src/styles/animationBudget.test.ts` enforces the first rule in the unit
suite. It scans every stylesheet and `<style jsx>` block for infinite
animations whose keyframes touch anything but transform/opacity, and fails on
any that is not on its allowlist. It also fails on stale allowlist entries, so
the list can only shrink.

## #2436 results

Measured with this probe on the same container and production build, on
`main` (before) and on the #2436 branch (after). Window 10 s, viewport 1440×900,
signed in, track loaded and paused.

| Route | Busy % | Style recalcs | Layouts | Paints/s | Viewports painted/s | Infinite animations | Hidden: requests | Reduced motion: still running |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Home | 3.00 → 0.86 | 83 → 24 | 62 → 3 | 14.8 → 1.2 | 8.76 → 0.97 | 11 → 9 | 5 → 1 | 1 → 0 |
| Player | 0.36 → 0.49 | 14 → 11 | 0 → 0 | 0 → 0 | 0 → 0 | 3 → 2 | 2 → 0 | 3 → 0 |
| Library | 0.19 → 0.13 | 1 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 1 → 0 | 2 → 0 | 1 → 0 |
| Shows | 2.53 → 0.36 | 91 → 16 | 0 → 0 | 62.1 → 0 | 11.57 → 0 | 9 → 3 | 3 → 1 | 1 → 0 |

The Home residue (about one viewport per 10 s) is the featured-campaign
rotation, which swaps the hero every 9 s by design. The one hidden request on
Home and Shows is the playback-device heartbeat. It stays on deliberately: the
backend drops a device it has not seen for 45 s, and an agent must still be
able to find a backgrounded player. Player busy % is noise at this level.

What the traces showed, and the fixes:

| Cause | Fix |
| --- | --- |
| Home hero ping ring animated inside the motif `<svg>`: style, layout, and a repaint of the 620px motif every frame, which also re-ran the hero card's `backdrop-filter` and repainted the full document about 9×/s | The ping is its own `<svg>` box animating transform/opacity on the compositor |
| Home hero motif rotated every 28 s, but rotating concentric circles about their centre is invisible | Rotation removed |
| Kicker-dot pulses (Home hero, Shows, artist campaign link) and the AI DJ orb animated `box-shadow`, so each frame repainted their blurred card. The orb pulsed even when the DJ was inactive | Scaling, fading ring on a pseudo-element |
| Shows progress bars animated `background-position`. A later `background` shorthand had reset `background-size`, so the sheen never moved visibly but repainted every bar every frame | Loop removed; the bars render exactly as before |
| Release page `.mesh-gradient-bg` animated `background-position` on a full-viewport fixed layer | Gradients on an oversized layer drifting with a composited translate; the 3–6% alpha blobs now drift together (not in the table: the offline probe has no release to open) |
| Home tuner EQ: 7 bars each firing `animationiteration` every second, each one a main-thread frame | Eight up/down swings per iteration: same motion, 16× fewer events |
| Player title marquee scrolled while playback was paused | Held still while paused |
| Hero auto-rotation, playback-command poll, on-chain balance poll, and crate quote countdown kept running in hidden tabs | `registerVisibleInterval`: paused while hidden (the command poll backs off to 30 s when nothing plays), with one catch-up run on return |
| Reduced motion covered only a few rules | Global kill-switch |

Pixel comparison of frozen frames before and after: Home differs only in text
anti-aliasing (8 px above 16/255), the Shows progress bars are identical, and
the Shows kicker ring differs by about 130 px (at most 27/255), from the
ring-for-shadow substitution.

### Remaining

- **Laptop and GPU numbers.** The acceptance criteria ask for idle CPU %, GPU %,
  JS heap, and idle FPS from the Chrome Task Manager on a mid-range laptop. A
  container has no GPU process, so this run reports the main-thread and paint
  equivalents above; the laptop pass is left for a human.
- **Backdrop-filter over motion.** Composited motion under a blurred surface
  still costs GPU work per frame. On Home, the ping ring passes behind the
  blurred campaign rail. On Shows, the two intro stat cards float while
  carrying `backdrop-filter`. Decide on the laptop GPU numbers whether
  these need a solid fill or a pause when off-screen.
- **Allowlisted legacy loops.** The allowlist in `animationBudget.test.ts`
  lists the paint-property loops that remain: loading skeletons, plus active
  states such as live-session pulses, mixer glows, Sonic Radar, and Punchline.
  None runs on idle Home, Player, Library, or Shows. Convert them as those
  surfaces are touched.
- **RAM over time.** The 10 s windows show a flat heap. A 10-minute heap-snapshot
  comparison (AI DJ history, long queues) has not been done.

## Related

- `web/scripts/measure-idle-cost.mjs`: the probe
- [Home performance harness](home-performance-harness.md): load-time metrics (LCP, CLS, bytes)
- [Accessibility baseline](../features/accessibility_baseline.md): reduced-motion contract
