# Load-cost harness

Status: **implemented** (tooling and guardrail) · Audience: frontend developers,
agents doing perf work

`npm run perf:load` (in `web/`) measures what opening a page costs the whole
computer during its first seconds. It exists because of a report the other two
harnesses could not explain: opening Resonate, Home in particular, made the
machine stutter for a few seconds.

| Harness | Question |
| --- | --- |
| [`perf:home`](home-performance-harness.md) | How fast does Home paint? (LCP, CLS, bytes) |
| [`perf:idle`](idle-cost-harness.md) | What does an open tab cost while nothing happens? |
| `perf:load` | How much CPU does the browser burn, in every process, while the page arrives? |

## Running it

```bash
cd web
NEXT_PUBLIC_MOCK_AUTH=true npm run build && npm start -- -p 3001
npm run perf:load
LOAD_ROUTES=/,/library LOAD_RUNS=5 npm run perf:load
```

The probe (`web/scripts/measure-load-cost.mjs`) opens the route the way a
returning listener does: signed in, HTTP cache warm, a track restored in the
player. On localhost it starts a small fake API
(`web/scripts/home-load-mock-api.mjs`) with a realistic Home: campaigns,
24 releases, trending, playlists, artwork. The settings are listed at the top
of the script. Results go to `web/build/perf/load-latest.json`.

It reports, as the median of the runs:

- CPU seconds per browser process over the window, CPU seconds in each second
  of it, and the busiest half second in cores;
- renderer main thread time, script, style, layout, long tasks;
- paints, raster time, image decodes, compositor frames and their total cost;
- DOM size, blurred surfaces, running infinite animations, requests by type.

Headless Chromium rasterizes and composites in software, so work a laptop does
on its GPU shows up here as CPU time in the GPU process. Read the numbers as
"how much drawing work", and compare runs only on the same machine and build
mode. `LOAD_INJECT_CSS` adds CSS to the measured tab for what-if runs (for
example turning every animation off); such a run is a diagnosis, never a
result.

## What the first reading showed

Home, first 6 s, production build, this container:

- 8.0 CPU seconds in total: 5.5 in the GPU process, 2.1 in the renderer.
  Script was about 350 ms of it. The cost was drawing, not JavaScript.
- The compositor drew a frame on every vsync from the moment the page
  hydrated, at about 25 ms a frame, because nine decorative loops (the hero
  ping and dot, seven tuner EQ bars) started with the page. With animations
  switched off the same load cost 2.8 CPU seconds.
- A third of every one of those frames went to one layer: a film grain over
  the whole viewport, blended with `mix-blend-mode: overlay`. A blend layer is
  composited together with everything behind it, again on every frame in which
  any of that changes.
- Every signed-in open shifted the whole page by 57 px (CLS 0.20): the server
  rendered the signed-out top bar, and the session was restored after
  hydration.
- Two catalog requests were sent twice, and two widgets far below the first
  screen (the Drops shelf and the AI DJ panel) sent ten requests during the
  busiest second.

## What was changed

1. **Decorative loops wait for the page to settle.** `IdleAnimationGuard`
   holds every infinite animation, except loading indicators, until the
   document has loaded and nothing has been added to it for 1.2 s
   (`web/src/lib/pageSettle.ts`, capped at 8 s). The loops are the same; they
   start about two seconds after opening instead of competing with the load.
2. **The grain layer is gone.** Over the dark canvas it moved a channel by
   less than half a level out of 255. Composited through GL, screenshots of
   every page with and without it are identical; the software compositor
   rounded some dark pixels up by one level. `animationBudget.test.ts` fails
   on a new `mix-blend-mode` on the shell or its page-sized children.
3. **The top bar keeps its height.** An inline script in the root layout marks
   `<html data-session="stored">` before first paint when a session is stored,
   and `ConnectButton` renders a chip-sized frame until the session is
   restored. Nothing jumps.
4. **Widgets below the first screen mount later.** `DeferredMount`
   (`web/src/components/system/DeferredMount.tsx`) shows the widget's own
   placeholder and mounts it once the page has settled and the browser is
   idle, or as soon as it comes within 800 px of the viewport.
5. **No duplicate catalog requests**, and the hero ping is drawn in a box the
   size of the ring instead of a hero-sized one.

## Before and after

Same container, production builds of `main` and the branch side by side,
medians of 5 runs.

CPU seconds in each second after opening Home:

| Second | 1 | 2 | 3 | 4 | 5 | 6 | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Before | 2.24 | 1.28 | 1.02 | 1.03 | 1.02 | 1.05 | 8.0 |
| After | 2.26 | 0.32 | 0.68 | 0.96 | 0.88 | 0.89 | 6.5 |

The first second is the page arriving and is unchanged. After it the page now
goes quiet: between 1.0 s and 2.0 s the compositor draws no frame at all.
From then on the loops run at about half the cost per frame, which the
software compositor here spends on drawing more frames per second (36 before,
60 after) rather than on idling.

In use, pointer moving (`perf:idle`, in-use phase):

| Route | ms per frame, before → after | Frames/s, before → after | Floor: every blur off, before → after |
| --- | --- | --- | --- |
| Home | 25.9 → 13.7 | 36 → 60 | 12.3 → 4.1 |
| Player | 33.5 → 23.1 | 29 → 42 | 10.1 → 2.6 |
| Shows | 8.4 → 3.4 | 60 → 60 | 8.4 → 3.2 |

Other readings on Home: layout shift on a signed-in open 0.20 → 0; requests
in the window 119 → 115, and the ten requests of the two deferred widgets now
start after the page has settled.

Pixel comparison of `main` against the branch (Home at three scroll
positions, signed out, phone width, 2x, Shows, Library, Player, reduced
motion, GL compositing): identical apart from sub-pixel differences on text
edges and on the hero ring, under 0.03% of pixels.

## Remaining

- The first second (about 2.2 CPU seconds here) is hydration plus drawing the
  first screen several times as data arrives in waves. The hero's layered
  radial gradients are the most expensive thing in each redraw.
- What is left per frame is `backdrop-filter`: the hero card and the sticky
  top bar on Home, the floating console on Player. That is chrome the owner
  chose to keep blurred.
- These are software-compositor numbers. The acceptance reading is a laptop:
  open Home with Chrome's Task Manager visible and watch the GPU process.

## Related

- `web/scripts/measure-load-cost.mjs`: the probe
- `web/scripts/home-load-mock-api.mjs`: the fake API it runs against
- [Idle-cost harness](idle-cost-harness.md)
- [Home performance harness](home-performance-harness.md)
