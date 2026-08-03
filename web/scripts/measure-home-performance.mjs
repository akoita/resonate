/**
 * Measure Home page performance against a running Resonate instance.
 *
 * Issue #1491 asks a question we could not answer with a number: "is Home
 * fast?". This harness turns it into reproducible evidence. It drives a real
 * Chromium via Playwright, loads the target route N times, and reports the
 * median (plus min/max, so variance is visible) for:
 *
 *   - LCP   — largest-contentful-paint, final entry
 *   - CLS   — sum of layout-shift entries with hadRecentInput === false
 *   - FCP   — first-contentful-paint
 *   - TTFB / DOMContentLoaded / load — from the navigation timing entry
 *   - TBT proxy — sum of max(0, longtask.duration - 50) after FCP
 *   - transferred bytes (total + JS) and request count
 *
 * It then prints a per-resource breakdown of one representative COLD load —
 * bytes by resource type, the heaviest individual responses, and an image
 * summary including how many distinct images exceed the heavy-image budget —
 * because aggregates say Home is heavy but not which assets to fix.
 *
 * Each iteration measures COLD (fresh browser context, empty cache) and then
 * WARM (a reload in that same context, so HTTP/disk cache is primed).
 *
 * INP is deliberately NOT reported: it is interaction-driven and cannot be
 * observed on a passive page load, and a fabricated number would be worse than
 * no number. The TBT proxy above is the responsiveness stand-in.
 *
 * Byte accounting uses Playwright's network layer (`requestfinished` +
 * `request.sizes()`), not `performance.getEntriesByType('resource')`: resource
 * timing reports transferSize 0 for cross-origin responses without
 * Timing-Allow-Origin, which would silently undercount CDN/bucket artwork.
 *
 * Usage:
 *   # Local dev server (default target):
 *   npm run perf:home
 *
 *   # Staging (same host scripts/capture-help-screenshots.mjs targets):
 *   PERF_BASE_URL=https://staging.resonate.pydes.xyz npm run perf:home
 *
 *   # More iterations / another route:
 *   PERF_RUNS=5 PERF_ROUTE=/catalog npm run perf:home
 *
 * Environment:
 *   PERF_BASE_URL   target origin (falls back to BASE_URL, then localhost:3001)
 *   BASE_URL        shared with scripts/capture-help-screenshots.mjs
 *   PERF_ROUTE      route to measure (default "/")
 *   PERF_RUNS       iterations (default 3)
 *   PERF_SETTLE_MS  quiet time after load before reading metrics (default 3000)
 *   PERF_TIMEOUT_MS navigation timeout (default 60000)
 *   PERF_PAUSE_MS   pause between iterations, eases rate limiters (default 2000)
 *   PERF_MAX_RETRIES extra attempts allowed for discarded runs (default 3)
 *   PERF_OUT_DIR    JSON output directory (default web/build/perf, gitignored)
 *   PERF_HEADED     set to "true" to watch the run
 *   PERF_TOP_RESPONSES       heaviest responses to list (default 15)
 *   PERF_IMAGE_BUDGET_BYTES  heavy-image threshold (default 204800 = 200 KB)
 *
 * Requirements: a Chromium browser for Playwright
 *   npx playwright install chromium
 *
 * Output: a stdout table plus JSON at
 * web/build/perf/home-<timestamp>.json (and home-latest.json).
 *
 * Caveat: numbers are only comparable to other numbers from the SAME machine,
 * network, and target. Never compare a laptop run to a CI run.
 */
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL =
  process.env.PERF_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:3001";
const ROUTE = process.env.PERF_ROUTE ?? "/";
const RUNS = Math.max(1, Number(process.env.PERF_RUNS ?? 3));
const SETTLE_MS = Number(process.env.PERF_SETTLE_MS ?? 3000);
const TIMEOUT_MS = Number(process.env.PERF_TIMEOUT_MS ?? 60000);
const PAUSE_MS = Number(process.env.PERF_PAUSE_MS ?? 2000);
const MAX_RETRIES = Math.max(0, Number(process.env.PERF_MAX_RETRIES ?? 3));
const HEADED = process.env.PERF_HEADED === "true";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.PERF_OUT_DIR
  ? path.resolve(process.env.PERF_OUT_DIR)
  : path.resolve(SCRIPT_DIR, "../build/perf");

const TARGET = `${BASE_URL.replace(/\/$/, "")}${ROUTE}`;
const VIEWPORT = { width: 1440, height: 900 };

/**
 * Installed before any script of the page runs, on every navigation (including
 * the warm reload), so the observers never miss an early entry.
 */
const COLLECTOR = () => {
  const perf = {
    lcp: 0,
    cls: 0,
    longTasks: [],
  };
  window.__resonatePerf = perf;

  const observe = (type, handler, extra = {}) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(handler)).observe({
        type,
        buffered: true,
        ...extra,
      });
    } catch {
      // Entry type unsupported in this browser — leave the metric at 0.
    }
  };

  // Final LCP entry wins; we never interact, so it is not cut short early.
  observe("largest-contentful-paint", (entry) => {
    perf.lcp = entry.startTime;
  });
  observe("layout-shift", (entry) => {
    if (!entry.hadRecentInput) perf.cls += entry.value;
  });
  observe("longtask", (entry) => {
    perf.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
  });
};

/** Read everything back out of the page once it has settled. */
const READER = () => {
  const perf = window.__resonatePerf ?? { lcp: 0, cls: 0, longTasks: [] };
  const nav = performance.getEntriesByType("navigation")[0];
  const fcp =
    performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;

  // TBT proxy: blocking time of long tasks once the first paint has landed.
  const tbtProxyMs = perf.longTasks
    .filter((t) => t.startTime >= fcp)
    .reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0);

  return {
    lcpMs: perf.lcp,
    cls: perf.cls,
    fcpMs: fcp,
    ttfbMs: nav ? nav.responseStart : 0,
    domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : 0,
    loadMs: nav ? nav.loadEventEnd : 0,
    tbtProxyMs,
    longTaskCount: perf.longTasks.length,
  };
};

const isOkStatus = (status) => status >= 200 && status < 300;

function newBucket() {
  return { pending: [], totalBytes: 0, jsBytes: 0, requests: 0, resources: [] };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function drainBucket(bucket) {
  await Promise.all(bucket.pending);
  bucket.pending = [];
  return {
    totals: {
      totalBytes: bucket.totalBytes,
      jsBytes: bucket.jsBytes,
      requests: bucket.requests,
    },
    resources: bucket.resources,
  };
}

/**
 * Wait for the page to go quiet, then read the metrics. `networkidle` is
 * best-effort: a page with a live socket or polling never reaches it, and the
 * settle delay is what actually guarantees late LCP candidates are counted.
 */
async function settleAndRead(page) {
  await page.waitForLoadState("networkidle", { timeout: TIMEOUT_MS }).catch(() => {});
  await sleep(SETTLE_MS);
  return page.evaluate(READER);
}

async function measureOnce(browser, attempt) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  let bucket = newBucket();

  context.on("requestfinished", (request) => {
    const active = bucket;
    active.requests += 1;
    active.pending.push(
      request
        .sizes()
        .then((sizes) => {
          const bytes = (sizes.responseBodySize ?? 0) + (sizes.responseHeadersSize ?? 0);
          const type = request.resourceType();
          active.totalBytes += bytes;
          if (type === "script") active.jsBytes += bytes;
          // Per-response record; feeds the breakdown that tells us WHICH assets
          // are heavy, not just how many bytes there are in total.
          active.resources.push({ url: request.url(), type, bytes });
        })
        .catch(() => {
          // Request torn down before sizes resolved — skip it rather than fail.
        }),
    );
  });

  const page = await context.newPage();
  await page.addInitScript(COLLECTOR);

  const coldResponse = await page.goto(TARGET, { waitUntil: "load", timeout: TIMEOUT_MS });
  const coldTiming = await settleAndRead(page);
  const coldDrain = await drainBucket(bucket);
  const cold = { ...coldTiming, ...coldDrain.totals };

  // Swap the accounting bucket so warm bytes are counted separately, then
  // reload in the same context — cache, connections and origin state stay hot.
  bucket = newBucket();
  const warmResponse = await page.reload({ waitUntil: "load", timeout: TIMEOUT_MS });
  const warmTiming = await settleAndRead(page);
  const warmDrain = await drainBucket(bucket);
  const warm = { ...warmTiming, ...warmDrain.totals };

  await context.close();

  // A rate-limited or errored document still "loads" and would otherwise be
  // recorded as a suspiciously fast Home. Staging returns 429 under repeated
  // hits, so validate the main document before trusting the sample.
  const coldStatus = coldResponse?.status() ?? 0;
  const warmStatus = warmResponse?.status() ?? 0;
  const ok = isOkStatus(coldStatus) && isOkStatus(warmStatus);

  if (!ok) {
    console.warn(
      `  attempt ${attempt}  DISCARDED — document status cold ${coldStatus} / ` +
        `warm ${warmStatus} (expected 2xx)`,
    );
  } else {
    console.log(
      `  attempt ${attempt}  cold LCP ${Math.round(cold.lcpMs)}ms · ` +
        `warm LCP ${Math.round(warm.lcpMs)}ms`,
    );
  }

  // Only cold resources are kept: on the warm reload nearly every static asset
  // is a cache hit reporting ~0 bytes, so a warm breakdown would be a list of
  // zeroes plus whatever the API refetched — noise, not signal.
  return { cold, warm, coldStatus, warmStatus, ok, coldResources: coldDrain.resources };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const METRICS = [
  { key: "lcpMs", label: "LCP", unit: "ms" },
  { key: "fcpMs", label: "FCP", unit: "ms" },
  { key: "ttfbMs", label: "TTFB", unit: "ms" },
  { key: "domContentLoadedMs", label: "DOMContentLoaded", unit: "ms" },
  { key: "loadMs", label: "load", unit: "ms" },
  { key: "cls", label: "CLS", unit: "" },
  { key: "tbtProxyMs", label: "TBT proxy (long tasks)", unit: "ms" },
  { key: "longTaskCount", label: "long tasks", unit: "" },
  { key: "totalBytes", label: "transferred total", unit: "KB" },
  { key: "jsBytes", label: "transferred JS", unit: "KB" },
  { key: "requests", label: "requests", unit: "" },
];

function summarize(samples) {
  const summary = {};
  for (const { key } of METRICS) {
    const values = samples.map((sample) => sample[key]);
    summary[key] = {
      median: median(values),
      min: Math.min(...values),
      max: Math.max(...values),
      samples: values,
    };
  }
  return summary;
}

function formatValue(value, unit) {
  if (unit === "KB") return (value / 1024).toFixed(1);
  if (unit === "ms") return Math.round(value).toString();
  if (unit === "") return Number.isInteger(value) ? String(value) : value.toFixed(4);
  return String(value);
}

function printTable(cold, warm) {
  const header = ["metric", "cold median", "cold min–max", "warm median", "warm min–max"];
  const rows = METRICS.map(({ key, label, unit }) => {
    const suffix = unit === "KB" ? " KB" : unit === "ms" ? " ms" : "";
    const cell = (stats) => formatValue(stats.median, unit) + suffix;
    const range = (stats) =>
      `${formatValue(stats.min, unit)}–${formatValue(stats.max, unit)}`;
    return [label, cell(cold[key]), range(cold[key]), cell(warm[key]), range(warm[key])];
  });

  const widths = header.map((_, col) =>
    Math.max(header[col].length, ...rows.map((row) => row[col].length)),
  );
  const line = (cells) =>
    cells.map((cell, col) => cell.padEnd(widths[col])).join("  ").trimEnd();

  console.log("");
  console.log(line(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  rows.forEach((row) => console.log(line(row)));
}

// Playwright resourceType -> reporting group. `media` is kept separate rather
// than folded into "other": on a music app an audio response hiding in "other"
// would be exactly the kind of thing this breakdown exists to surface.
const TYPE_GROUPS = {
  image: "image",
  script: "script",
  stylesheet: "stylesheet",
  font: "font",
  media: "media",
  xhr: "fetch/xhr",
  fetch: "fetch/xhr",
  document: "document",
};
const GROUP_ORDER = [
  "image",
  "script",
  "stylesheet",
  "font",
  "media",
  "fetch/xhr",
  "document",
  "other",
];
const IMAGE_HEAVY_BYTES = Number(process.env.PERF_IMAGE_BUDGET_BYTES ?? 200 * 1024);
const TOP_RESPONSES = Math.max(1, Number(process.env.PERF_TOP_RESPONSES ?? 15));

const groupOf = (type) => TYPE_GROUPS[type] ?? "other";

/** Shorten a URL for the table while keeping both ends recognisable. */
function shortenUrl(url, max = 78) {
  if (url.length <= max) return url;
  const head = Math.ceil((max - 1) * 0.62);
  const tail = max - 1 - head;
  return `${url.slice(0, head)}…${url.slice(-tail)}`;
}

/**
 * Per-resource breakdown for one cold load: bytes by type, the heaviest
 * individual responses, and an image-specific summary. Aggregates are useless
 * for targeting a fix — this says WHICH assets to go after.
 */
function buildBreakdown(resources) {
  const byType = GROUP_ORDER.map((group) => {
    const items = resources.filter((r) => groupOf(r.type) === group);
    return {
      group,
      count: items.length,
      bytes: items.reduce((sum, r) => sum + r.bytes, 0),
    };
  }).filter((row) => row.count > 0);

  const topResponses = [...resources]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, TOP_RESPONSES)
    .map((r) => ({ url: r.url, type: r.type, bytes: r.bytes }));

  const imageResponses = resources.filter((r) => groupOf(r.type) === "image");
  // Distinct by URL: the same artwork requested twice is one asset to fix, but
  // the duplicate request is itself worth seeing, so both numbers are reported.
  const distinctImages = new Map();
  for (const r of imageResponses) {
    const previous = distinctImages.get(r.url);
    if (!previous || r.bytes > previous) distinctImages.set(r.url, r.bytes);
  }
  const distinctSizes = [...distinctImages.values()];
  const overBudget = [...distinctImages.entries()]
    .filter(([, bytes]) => bytes > IMAGE_HEAVY_BYTES)
    .sort((a, b) => b[1] - a[1])
    .map(([url, bytes]) => ({ url, bytes }));

  return {
    byType,
    topResponses,
    images: {
      totalBytes: imageResponses.reduce((sum, r) => sum + r.bytes, 0),
      responseCount: imageResponses.length,
      distinctCount: distinctImages.size,
      duplicateRequests: imageResponses.length - distinctImages.size,
      medianBytes: distinctSizes.length ? median(distinctSizes) : 0,
      maxBytes: distinctSizes.length ? Math.max(...distinctSizes) : 0,
      heavyThresholdBytes: IMAGE_HEAVY_BYTES,
      heavyCount: overBudget.length,
      heavyBytes: overBudget.reduce((sum, r) => sum + r.bytes, 0),
      heavy: overBudget,
    },
  };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function printRows(header, rows) {
  const widths = header.map((_, col) =>
    Math.max(header[col].length, ...rows.map((row) => row[col].length)),
  );
  const line = (cells) =>
    cells.map((cell, col) => cell.padEnd(widths[col])).join("  ").trimEnd();
  console.log(line(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  rows.forEach((row) => console.log(line(row)));
}

function printBreakdown(breakdown, runLabel) {
  const total = breakdown.byType.reduce((sum, row) => sum + row.bytes, 0);

  console.log("");
  console.log(`Cold bytes by resource type — ${runLabel}`);
  printRows(
    ["type", "count", "bytes", "share"],
    breakdown.byType
      .slice()
      .sort((a, b) => b.bytes - a.bytes)
      .map((row) => [
        row.group,
        String(row.count),
        kb(row.bytes),
        total ? `${((row.bytes / total) * 100).toFixed(1)}%` : "—",
      ]),
  );

  console.log("");
  console.log(`Top ${breakdown.topResponses.length} heaviest cold responses`);
  printRows(
    ["#", "bytes", "type", "url"],
    breakdown.topResponses.map((r, index) => [
      String(index + 1),
      kb(r.bytes),
      r.type,
      shortenUrl(r.url),
    ]),
  );

  const img = breakdown.images;
  console.log("");
  console.log("Images (cold)");
  console.log(
    `  ${kb(img.totalBytes)} across ${img.responseCount} response(s), ` +
      `${img.distinctCount} distinct URL(s)` +
      (img.duplicateRequests ? `, ${img.duplicateRequests} duplicate request(s)` : ""),
  );
  console.log(`  median ${kb(img.medianBytes)} · max ${kb(img.maxBytes)}`);
  console.log(
    `  ${img.heavyCount} distinct image(s) over ${kb(img.heavyThresholdBytes)} ` +
      `= ${kb(img.heavyBytes)} — the next/image candidates (full list in the JSON)`,
  );
}

async function main() {
  console.log(`Resonate Home performance — ${TARGET}`);
  console.log(
    `${RUNS} iteration(s), ${VIEWPORT.width}x${VIEWPORT.height}, ` +
      `${SETTLE_MS}ms settle, cold + warm per iteration`,
  );

  const browser = await chromium.launch({ headless: !HEADED });
  const runs = [];
  const discarded = [];
  const maxAttempts = RUNS + MAX_RETRIES;
  try {
    for (let attempt = 1; runs.length < RUNS && attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) await sleep(PAUSE_MS);
      const result = await measureOnce(browser, attempt);
      if (result.ok) runs.push(result);
      else discarded.push({ attempt, cold: result.coldStatus, warm: result.warmStatus });
    }
  } finally {
    await browser.close();
  }

  if (runs.length < RUNS) {
    console.error("");
    console.error(
      `Only ${runs.length}/${RUNS} usable run(s) after ${maxAttempts} attempts — ` +
        `the target kept returning non-2xx documents. Raise PERF_PAUSE_MS if it is ` +
        `rate limiting, and do not trust partial numbers.`,
    );
    if (runs.length === 0) process.exit(1);
  }

  const cold = summarize(runs.map((run) => run.cold));
  const warm = summarize(runs.map((run) => run.warm));
  printTable(cold, warm);

  // The breakdown describes one concrete load, so averaging URLs across runs
  // would invent a page that never rendered. Use the run whose cold payload is
  // closest to the median instead — a real, representative load.
  const medianColdBytes = cold.totalBytes.median;
  const representativeIndex = runs.reduce(
    (best, run, index) =>
      Math.abs(run.cold.totalBytes - medianColdBytes) <
      Math.abs(runs[best].cold.totalBytes - medianColdBytes)
        ? index
        : best,
    0,
  );
  const breakdown = buildBreakdown(runs[representativeIndex].coldResources);
  printBreakdown(
    breakdown,
    `run ${representativeIndex + 1} of ${runs.length}, closest to median cold bytes`,
  );

  console.log("");
  console.log("INP is not reported: it requires real user interaction and cannot be");
  console.log("measured on a passive load. 'TBT proxy' is the responsiveness stand-in.");
  console.log("Bytes are wire sizes from Playwright's network layer (body + headers).");
  console.log("Only compare runs from the same machine, network and target.");
  if (discarded.length) {
    console.log(
      `${discarded.length} attempt(s) discarded for non-2xx documents (see JSON).`,
    );
  }

  const report = {
    schema: "resonate.home-performance/1",
    target: TARGET,
    route: ROUTE,
    baseUrl: BASE_URL,
    measuredAt: new Date().toISOString(),
    runs: runs.length,
    requestedRuns: RUNS,
    discardedAttempts: discarded,
    viewport: VIEWPORT,
    settleMs: SETTLE_MS,
    notes: {
      inp: "omitted — interaction-driven, not observable on a passive load",
      tbtProxyMs: "sum of max(0, longtask.duration - 50) for long tasks after FCP",
      bytes: "Playwright request.sizes(): responseBodySize + responseHeadersSize",
      comparability: "only comparable across runs on the same machine/network/target",
      breakdown:
        "cold load only, from a single representative run (warm is cache hits at ~0 bytes)",
    },
    cold,
    warm,
    breakdown: {
      basis: "cold",
      representativeRun: representativeIndex + 1,
      ...breakdown,
    },
    coldResources: runs[representativeIndex].coldResources,
    rawRuns: runs.map(({ cold: c, warm: w, coldStatus, warmStatus }) => ({
      cold: c,
      warm: w,
      coldStatus,
      warmStatus,
    })),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = report.measuredAt.replace(/[:.]/g, "-");
  const outFile = path.join(OUT_DIR, `home-${stamp}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    path.join(OUT_DIR, "home-latest.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  console.log("");
  console.log(`JSON: ${outFile}`);
  console.log(`JSON: ${path.join(OUT_DIR, "home-latest.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
