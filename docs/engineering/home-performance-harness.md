# Home performance measurement harness

Status: **implemented** · Audience: frontend developers, agents doing perf work
· Tracking: [#1491](https://github.com/akoita/resonate/issues/1491)

Before this harness there was no way to answer "is Home fast?" with a number,
so perf work on the Home page was guesswork. `web/scripts/measure-home-performance.mjs`
drives a real Chromium (Playwright, already a devDependency — no new tooling)
against a running Resonate instance and prints reproducible numbers plus a JSON
artifact you can diff before/after a change.

This is engineering tooling, not a product feature: it changes nothing a
listener or artist can see.

## Run it

```bash
cd web

# Local dev server (default target: http://localhost:3001)
npm run perf:home

# Staging — same host scripts/capture-help-screenshots.mjs targets
PERF_BASE_URL=https://staging.resonate.pydes.xyz npm run perf:home

# More iterations, or a different route
PERF_RUNS=7 npm run perf:home
PERF_ROUTE=/catalog npm run perf:home
```

The target **always** comes from the environment. Never edit the default in the
script to point at a deployment.

| Variable          | Default                        | Purpose                                            |
| ----------------- | ------------------------------ | -------------------------------------------------- |
| `PERF_BASE_URL`   | `BASE_URL`, then `http://localhost:3001` | Origin to measure                        |
| `BASE_URL`        | —                              | Shared fallback with the screenshot script          |
| `PERF_ROUTE`      | `/`                            | Route to measure                                    |
| `PERF_RUNS`       | `3`                            | Iterations (each is cold + warm)                    |
| `PERF_SETTLE_MS`  | `3000`                         | Quiet time after `load` before reading metrics      |
| `PERF_TIMEOUT_MS` | `60000`                        | Navigation timeout                                  |
| `PERF_PAUSE_MS`   | `2000`                         | Pause between iterations; raise it if the target rate limits |
| `PERF_MAX_RETRIES`| `3`                            | Extra attempts allowed to replace discarded runs     |
| `PERF_OUT_DIR`    | `web/build/perf`               | JSON output directory                               |
| `PERF_HEADED`     | unset                          | `true` to watch the browser                         |

Requires a Chromium for Playwright (`npx playwright install chromium`). Against
a local target, run `npm run build && npm run start` first if you care about
production numbers — `next dev` numbers are dominated by on-demand compilation
and are not representative.

## What it measures

Per iteration the harness measures **cold** (fresh browser context, empty cache)
then **warm** (a reload in that same context, so HTTP/disk cache and connections
are primed). It reports the **median** across iterations plus **min–max**, so
run-to-run variance is visible; a single sample is noise.

| Metric                   | Source                                                        |
| ------------------------ | ------------------------------------------------------------- |
| LCP                      | `PerformanceObserver` on `largest-contentful-paint`, final entry |
| CLS                      | Sum of `layout-shift` entries with `hadRecentInput === false`  |
| FCP                      | `first-contentful-paint` paint entry                           |
| TTFB / DOMContentLoaded / load | Navigation timing entry                                  |
| TBT proxy                | Sum of `max(0, longtask.duration - 50)` for long tasks after FCP |
| long tasks               | Count of `longtask` entries                                    |
| transferred total / JS   | Playwright `requestfinished` + `request.sizes()`               |
| requests                 | Count of finished requests                                     |

Two deliberate choices:

- **INP is not reported.** INP is interaction-driven and cannot be observed on a
  passive page load. Reporting a fabricated value would be worse than reporting
  none, so the harness omits it and uses the **TBT proxy** as the main-thread
  responsiveness stand-in. Measure INP with a real interaction script (or field
  RUM) if you need it.
- **Byte accounting uses Playwright's network layer**, not
  `performance.getEntriesByType('resource')`. Resource timing reports
  `transferSize: 0` for cross-origin responses without `Timing-Allow-Origin`,
  which would silently undercount artwork served from a bucket/CDN. The reported
  bytes are wire sizes (`responseBodySize + responseHeadersSize`).

## Reading the output

stdout is a table; the same data lands as JSON in `web/build/perf/` —
`home-<timestamp>.json` for the record and `home-latest.json` for convenience.
`web/build/` is gitignored, so measurement output is never committed.

Example — staging Home, 5 iterations, 1440x900 (2026-08-03):

```
metric                  cold median  cold min–max   warm median  warm min–max
----------------------  -----------  -------------  -----------  -------------
LCP                     1744 ms      1376–2472      1000 ms      812–1084
FCP                     556 ms       464–664        856 ms       664–924
TTFB                    89 ms        69–106         43 ms        29–50
DOMContentLoaded        359 ms       306–378        112 ms       54–187
load                    561 ms       409–2459       166 ms       102–241
CLS                     0.0500       0.0500–0.0500  0.0015       0.0015–0.0015
TBT proxy (long tasks)  43 ms        0–71           0 ms         0–0
long tasks              5            4–7            1            0–2
transferred total       7501.0 KB    7500.9–7502.0  1733.3 KB    1703.8–1734.2
transferred JS          527.8 KB     527.8–528.8    0.0 KB       0.0–0.0
requests                171          169–171        169          116–170
```

How to read it:

- **Compare medians, glance at min–max.** If a "win" is smaller than the min–max
  spread of either run, it is not a win — raise `PERF_RUNS` and re-measure.
- **Warm bytes that stay high are uncacheable payload.** Warm JS at ~0 KB means
  the bundle cached correctly; the ~1.7 MB warm total above is API/XHR data, not
  static assets.
- **Cold transferred total and request count are the composition signals.** A
  7.5 MB / 171-request cold Home is a shopping list of images and fetches, which
  is exactly the Home-composition work #1491 tracks.
- **CLS above ~0.1 means visible reflow**; the cold/warm gap shows how much of it
  is data arriving late rather than layout being wrong.

## Rate limiting and discarded runs

Staging rate-limits repeated hits and returns `429`. A 429 page still "loads",
and without a guard it would be recorded as a spectacularly fast Home (~29 KB,
4 requests, LCP 340 ms — observed while building this harness). The script
therefore checks the **main document HTTP status** for both the cold load and
the warm reload, discards any attempt that is not 2xx, and retries up to
`PERF_MAX_RETRIES` extra attempts:

```
  attempt 4  DISCARDED — document status cold 200 / warm 429 (expected 2xx)
  attempt 5  DISCARDED — document status cold 429 / warm 429 (expected 2xx)
  attempt 6  cold LCP 1744ms · warm LCP 1000ms
```

Discarded attempts are listed in the JSON under `discardedAttempts`. If you see
many, raise `PERF_PAUSE_MS`. If the harness cannot collect a single usable run it
exits non-zero rather than reporting fiction.

Sanity check for any run: cold `requests` and `transferred total` should be in
the same order of magnitude as previous runs. A sudden collapse means you
measured an error page, not a fast page.

## Caveat: numbers are machine-local

**Runs from different machines, networks, or targets are not comparable.** These
numbers depend on CPU, DNS/TLS latency, cache state of the CDN, and what else is
running locally. The harness is only meaningful as **before/after on the same
machine against the same target in the same session**. Do not treat a number
from a laptop as a shared budget, and do not compare a local run to a staging
run.

To do a before/after:

```bash
cd web
PERF_BASE_URL=<target> npm run perf:home   # baseline; copy build/perf/home-latest.json aside
# ... make the change, redeploy/rebuild ...
PERF_BASE_URL=<target> npm run perf:home   # after
```

Then diff the two JSON files. The `notes` block in each JSON records the
methodology so an old artifact stays interpretable.

## Related

- `web/scripts/measure-home-performance.mjs` — the harness
- `web/scripts/capture-help-screenshots.mjs` — sibling Playwright script, same conventions
- [#1491](https://github.com/akoita/resonate/issues/1491) — Home performance audit & fix
- [`docs/engineering/change_impact_checklist.md`](change_impact_checklist.md)
