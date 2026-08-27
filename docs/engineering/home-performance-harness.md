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
PERF_ROUTE=/catalog PERF_EXPECTED_SELECTOR=.home-ng.ng-catalog-page npm run perf:home
```

The target **always** comes from the environment. Never edit the default in the
script to point at a deployment.

| Variable          | Default                        | Purpose                                            |
| ----------------- | ------------------------------ | -------------------------------------------------- |
| `PERF_BASE_URL`   | `BASE_URL`, then `http://localhost:3001` | Origin to measure                        |
| `BASE_URL`        | —                              | Shared fallback with the screenshot script          |
| `PERF_ROUTE`      | `/`                            | Route to measure                                    |
| `PERF_EXPECTED_SELECTOR` | —                      | Required landmark for non-Home routes; without it, validation is status-only |
| `PERF_RUNS`       | `3`                            | Iterations (each is cold + warm)                    |
| `PERF_SETTLE_MS`  | `3000`                         | Quiet time after `load` before reading metrics      |
| `PERF_TIMEOUT_MS` | `60000`                        | Navigation timeout                                  |
| `PERF_PAUSE_MS`   | `2000`                         | Pause between iterations; raise it if the target rate limits |
| `PERF_MAX_RETRIES`| `3`                            | Extra attempts allowed to replace discarded runs     |
| `PERF_OUT_DIR`    | `web/build/perf`               | JSON output directory                               |
| `PERF_HEADED`     | unset                          | `true` to watch the browser                         |
| `PERF_TOP_RESPONSES` | `15`                        | How many heaviest responses to list                  |
| `PERF_IMAGE_BUDGET_BYTES` | `204800` (200 KB)      | Threshold for "heavy image" / `next/image` candidate |

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
| Next image optimizer cache | `x-nextjs-cache` on `/_next/image` responses; status counts plus exact HIT/MISS counters |

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

## Home performance budget

The #1491 Home budget is an operator acceptance target for staging, not a CI
gate or a promise that every local run will meet the number:

| Budget | Target | How to verify |
| --- | --- | --- |
| Cold LCP | **< 2.5 s median** | Five accepted cold runs from the harness |
| Cold CLS | **< 0.1 median** | The harness CLS summary |
| First paint | **No unstyled flash** | Browser screenshot/manual pass; the harness structural guard must also pass |
| Load completeness | **No discarded cold/warm pairs** | The harness accepts both navigations with all Home landmarks |
| Heavy Home artwork | **No distinct image over 100 KiB** for the reviewed Home payload | Run with `PERF_IMAGE_BUDGET_BYTES=102400` and inspect `breakdown.images.heavy` |

Use the same machine, network, target, viewport, settle time, and accepted-run
count for before/after comparisons. TBT proxy and request count remain useful
diagnostics, but they are not hard budgets here: passive timing variance and
intentional contextual prefetches make a single fixed threshold misleading. A
budget miss should be recorded with the raw JSON artifact and investigated;
do not relax the target just to make a run pass.

Recommended staging check:

```bash
PERF_BASE_URL=<staging-origin> PERF_RUNS=5 PERF_MAX_RETRIES=3 \
  PERF_IMAGE_BUDGET_BYTES=102400 npm run perf:home
```

## #1491 completion evidence

The Home performance investigation is complete. The work deliberately followed
the measurements instead of applying every optimization proposed before a
baseline existed:

| Acceptance area | Implemented evidence |
| --- | --- |
| Measure first | [#1550](https://github.com/akoita/resonate/pull/1550) added this repeatable cold/warm harness and recorded the staging baseline in [#1491](https://github.com/akoita/resonate/issues/1491). |
| Drops card and first paint | The card owns its stylesheet, and [#1594](https://github.com/akoita/resonate/pull/1594) adds Home-only lazy artwork decoding plus `content-visibility` without changing the approved shared card design. The measured main-thread cost did not justify removing its visual effects. |
| Home composition | [#1549](https://github.com/akoita/resonate/pull/1549) defers below-fold sections, [#1565](https://github.com/akoita/resonate/pull/1565) removes persistent-sidebar route prefetch, and [#1562](https://github.com/akoita/resonate/pull/1562) plus [#1572](https://github.com/akoita/resonate/pull/1572) size release and Shows artwork responsively. |
| Stable measurement | [#1587](https://github.com/akoita/resonate/pull/1587) rejects incomplete 2xx samples, while [#1591](https://github.com/akoita/resonate/pull/1591) reports exact Next optimizer cache status. |
| Durable budget | [#1588](https://github.com/akoita/resonate/pull/1588) defines the budget above and adds it to the engineering change-impact checklist. |
| Upload and optimizer bounds | [#1589](https://github.com/akoita/resonate/pull/1589) and [#1590](https://github.com/akoita/resonate/pull/1590) bound artwork ingestion; [#1592](https://github.com/akoita/resonate/pull/1592) adds bounded opt-in cache-TTL and Sharp-concurrency controls. |

The published baseline transferred about **7,501 KiB** over roughly **171
requests**. The final completeness-aware staging pass on 2026-08-10 retained
all five cold/warm pairs and recorded a **1,148.2 KiB cold median**, **94 cold
requests**, **1,440 ms cold LCP median**, and **no image over 100 KiB**. The
earlier post-prefetch pass recorded a **0.085947 cold CLS median**, inside the
`<0.1` budget, and the stylesheet correction was visually verified without an
unstyled flash. Timing measurements remain machine-local; the repeatable
payload, request, completeness, and image-budget results are the reliable
comparison.

The original issue proposed one-off Lighthouse plus passive INP reporting. The
implementation deliberately replaced that with this repeatable Playwright
network/Web Vitals harness: passive navigation cannot produce a valid INP, and
the harness therefore reports a TBT proxy while documenting that real INP needs
an interaction script or field RUM. This is an explicit measurement-method
refinement, not a claim that INP was collected.

Two independent hardening opportunities remain tracked outside #1491:

- [#1604](https://github.com/akoita/resonate/issues/1604) adds persisted,
  server-owned revisions to release and Shows artwork URLs. The repository
  implementation keeps legacy paths readable and the optimizer TTL default at
  `0`; enabling a nonzero deployment value remains gated on the same-machine
  staging procedure below.
- [#1605](https://github.com/akoita/resonate/issues/1605) cancels and bounds
  sibling audio work after multipart artwork rejection.

Neither follow-up changes the measured conclusion that Home meets its current
performance budget.

### Artwork cache-coherency rollout (#1604)

Mutable release covers and Shows hero/card/gallery visuals use canonical
version path segments such as `artwork/v2` and `visuals/hero/v2`. A successful
replacement increments the revision in the same database mutation that changes
the image, so new application reads switch optimizer keys immediately. The
legacy unversioned endpoints remain readable for rollback and older clients;
they resolve the current image and are not historical snapshots.

Before setting `IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL` above `0` in a deployed
environment:

1. deploy the versioned backend and frontend with the TTL still at `0`;
2. capture the optimizer request URL for a release cover and a Shows visual,
   replace each asset, and verify the next request contains a higher revision;
3. retain evidence that both legacy URLs still read successfully;
4. run five accepted cold/warm Home pairs on the same staging target and
   machine with `PERF_IMAGE_BUDGET_BYTES=102400`;
5. record the target commit, viewport, settle time, raw JSON artifact,
   discarded attempts, exact HIT/MISS counts, and
   `breakdown.images.heavy`; and
6. trial and document the smallest bounded nonzero TTL supported by that warm
   cache evidence.

Use the fail-closed [#1666 staging runbook](../operations/artwork-cache-staging-validation.md)
for fixture approval, private rollback evidence, exact release/runtime
reconciliation, replacement commands, record sanitization, and maintenance-
window closure. The repository sample Shows campaigns are active and therefore
are not valid replacement fixtures; the supported API trial uses a newly
created disposable draft campaign.

Rollback is setting the deployment variable back to `0`; no schema rollback or
URL migration is required. Do not describe a nonzero TTL as selected or
production-ready until the staging record is linked from #1604.

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

The CLI also prints one concise cache-status line for all accepted loads, for
example `Next image optimizer cache — cold 25 request(s), 21 hit(s), 4
miss(es) [HIT 21, MISS 4] · warm 25 request(s), 25 hit(s), 0 miss(es) [HIT
25]`. Only requests whose URL path is exactly `/_next/image` are included.
Missing or unreadable `x-nextjs-cache` headers are counted as `unknown`; `STALE`
and `REVALIDATED` remain separate statuses rather than being guessed into the
hit/miss counters.

Each load in `rawRuns` carries an `optimizerCache` object with this shape:

```json
{
  "requestCount": 25,
  "statuses": {"HIT": 21, "MISS": 4, "STALE": 0, "REVALIDATED": 0, "unknown": 0},
  "hits": 21,
  "misses": 4
}
```

The top-level `cold.optimizerCache` and `warm.optimizerCache` fields combine
the same status counts across accepted runs. This is additive observability;
existing byte and request metrics are unchanged.

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

## Per-resource breakdown

Aggregates tell you Home is heavy; they do not tell you what to fix. Below the
metric table the harness prints three more blocks, all describing the **cold**
load of a **single representative run** — the run whose cold payload is closest
to the median. Averaging URLs across runs would describe a page that never
rendered, and the warm reload is almost entirely cache hits reporting ~0 bytes,
so neither is a useful basis.

1. **Bytes by resource type** — `image`, `script`, `stylesheet`, `font`,
   `media`, `fetch/xhr`, `document`, `other`, with count, wire bytes, and share
   of the cold payload. `media` is broken out rather than folded into `other`:
   on a music app, an audio response hiding in a catch-all bucket is exactly
   what this is meant to surface.
2. **Top N heaviest cold responses** (default 15) — bytes, type, URL. URLs are
   elided in the middle for the table and stored complete in the JSON.
3. **Image summary** — total image bytes, response count, distinct URL count,
   duplicate requests, median and max image size, and how many *distinct* images
   exceed `PERF_IMAGE_BUDGET_BYTES`. That last number is the `next/image`
   worklist; the full list of offenders is in the JSON under
   `breakdown.images.heavy`.

Example (staging, 2026-08-03) — note that the headline is **not** images:

```
Cold bytes by resource type — run 3 of 3, closest to median cold bytes
type        count  bytes      share
----------  -----  ---------  -----
font        10     4087.1 KB  53.9%
image       25     2697.9 KB  35.6%
script      48     528.5 KB   7.0%
fetch/xhr   76     160.6 KB   2.1%
stylesheet  9      96.1 KB    1.3%
document    1      10.0 KB    0.1%

Images (cold)
  2697.9 KB across 25 response(s), 25 distinct URL(s)
  median 89.8 KB · max 555.6 KB
  2 distinct image(s) over 200.0 KB = 927.7 KB — the next/image candidates
```

The JSON carries the same data under `breakdown` (`byType`, `topResponses`,
`images`) plus `coldResources`, the complete per-response list for the
representative run, so you can re-slice it without re-measuring.

## Completeness checks and discarded runs

An error or partially rendered page can still return `200` and look
spectacularly fast. A sample is accepted only when **both** its cold navigation
and warm reload return 2xx and pass the configured structural check. The Home
route (`PERF_ROUTE=/`) always requires these stable, unconditional landmarks:

- `.home-ng`
- `.home-ng .ng-hero`
- `.home-ng .ng-catalog-shell`
- `.home-ng .ng-ops-grid`
- `.home-ng .ng-section--presets`

For another route, set `PERF_EXPECTED_SELECTOR` to a stable landmark that is
present whenever that page is complete. Without it, a non-Home route uses an
explicit **status-only fallback**; the harness prints that mode before running.
The Home landmarks are never imposed on alternate routes.

Staging also rate-limits repeated hits and returns `429`. A 429 page still
"loads", and without a guard it would be recorded as a spectacularly fast Home
(~29 KB, 4 requests, LCP 340 ms — observed while building this harness). Status
and structural failures are treated the same way: the entire cold/warm pair is
discarded and the harness retries up to `PERF_MAX_RETRIES` extra attempts:

```
  attempt 4  DISCARDED — warm: document status 429 (expected 2xx)
  attempt 5  DISCARDED — cold: missing expected selector(s): .home-ng .ng-ops-grid
  attempt 6  cold LCP 1744ms · warm LCP 1000ms
```

Discarded attempts are listed in the JSON under `discardedAttempts`. Each entry
has top-level exact `reasons` plus structured `cold` and `warm` checks containing
the status, validation mode, expected/present/missing selectors, and acceptance
booleans. `rawRuns` contains accepted complete pairs only, with the same checks.
If you see many status failures, raise `PERF_PAUSE_MS`; missing selectors point
to an incomplete render or a landmark that needs deliberate maintenance. If the
harness cannot collect a single usable run it exits non-zero before calculating
or writing a summary.

The automatic landmarks are the primary completeness guard. As a manual second
check, cold `requests` and `transferred total` should remain in the same order of
magnitude as previous runs. A sudden collapse deserves investigation even if
the landmarks are present.

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
- [#1491](https://github.com/akoita/resonate/issues/1491) — completed Home performance audit & fix
- [#1604](https://github.com/akoita/resonate/issues/1604) — cache-coherent mutable artwork versioning
- [#1605](https://github.com/akoita/resonate/issues/1605) — mixed-ingestion sibling-stream cleanup
- [`docs/engineering/change_impact_checklist.md`](change_impact_checklist.md)
