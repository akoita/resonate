/**
 * Measure what opening a page costs the whole computer.
 *
 * `perf:home` answers "how fast does Home paint" (LCP, CLS, bytes) and
 * `perf:idle` answers "what does an open tab cost". Neither answers the report
 * behind this probe: opening Resonate makes the machine stutter for a few
 * seconds. That is a CPU question across every browser process, so this probe
 * opens the route in a fresh tab and, over the first seconds, records:
 *
 *   - CPU seconds per browser process (renderer, GPU, browser, utility) and
 *     the busiest half second, in cores. Headless Chromium rasterizes and
 *     composites in software, so GPU work shows up here as CPU time.
 *   - renderer main thread: task, script, style and layout time, long tasks,
 *     the longest task and a TBT figure (sum of long-task time over 50 ms)
 *   - paints, painted area (in viewports), image decodes and decoded pixels,
 *     raster time, and compositor frames with their cost (viz DrawAndSwap)
 *   - DOM size when the window closes, running infinite animations and
 *     backdrop-filter surfaces
 *   - requests, by type
 *
 * The tab is opened the way a returning listener opens it: signed in, HTTP
 * cache warm, a track restored in the player. Set LOAD_COLD=true for an empty
 * cache.
 *
 * Usage (production build; dev-mode numbers are dominated by compilation):
 *   NEXT_PUBLIC_MOCK_AUTH=true npm run build && npm start -- -p 3001
 *   npm run perf:load
 *   LOAD_ROUTES=/,/library LOAD_RUNS=5 npm run perf:load
 *
 * Environment:
 *   LOAD_BASE_URL    origin to measure (BASE_URL, then http://localhost:3001)
 *   LOAD_ROUTES      comma-separated routes (default "/")
 *   LOAD_RUNS        runs per route; the median run is reported (default 5)
 *   LOAD_WINDOW_MS   measured window from navigation start (default 6000)
 *   LOAD_COLD        "true" to clear the HTTP cache before every run
 *   LOAD_CPU_SLOWDOWN  CPU throttling rate for the renderer (default 1 = off)
 *   LOAD_MOCK_API    start the fake API (default true on localhost)
 *   LOAD_API_PORT    port of the fake API (default 3000)
 *   LOAD_SIGNED_IN   inject the E2E mock session (default true)
 *   LOAD_OUT_DIR     JSON output directory (default web/build/perf)
 *   LOAD_SCREENSHOT_DIR  write a screenshot per route when set
 *   LOAD_INJECT_CSS  extra CSS added to the measured tab, for what-if runs
 *                    (e.g. "*{backdrop-filter:none!important}"); never a result
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE  Chromium binary override
 *
 * Compare runs only on the same machine and the same build mode.
 */
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { MOCK_TRACK_ID, startHomeLoadMockApi } from "./home-load-mock-api.mjs";

const BASE_URL = (process.env.LOAD_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const ROUTES = (process.env.LOAD_ROUTES ?? "/").split(",").map((r) => r.trim()).filter(Boolean);
const RUNS = Math.max(1, Number(process.env.LOAD_RUNS ?? 5));
const WINDOW_MS = Number(process.env.LOAD_WINDOW_MS ?? 6000);
const COLD = process.env.LOAD_COLD === "true";
const CPU_SLOWDOWN = Math.max(1, Number(process.env.LOAD_CPU_SLOWDOWN ?? 1));
const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE_URL);
const MOCK_API = (process.env.LOAD_MOCK_API ?? String(IS_LOCAL)) === "true";
const API_PORT = Number(process.env.LOAD_API_PORT ?? 3000);
const SIGNED_IN = (process.env.LOAD_SIGNED_IN ?? "true") === "true";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.LOAD_OUT_DIR ? path.resolve(process.env.LOAD_OUT_DIR) : path.resolve(SCRIPT_DIR, "../build/perf");
const SCREENSHOT_DIR = process.env.LOAD_SCREENSHOT_DIR ? path.resolve(process.env.LOAD_SCREENSHOT_DIR) : null;
const INJECT_CSS = process.env.LOAD_INJECT_CSS ?? "";
const VIEWPORT = { width: 1440, height: 900 };
const SAMPLE_MS = 250;

// Same mock session as tests/auth.setup.ts (payload: sub "test-user", role "artist").
const MOCK_AUTH = {
  address: "0x742d35cc6634c0532925a3b844bc9e7595f1ea2c",
  token:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJyb2xlIjoiYXJ0aXN0IiwiYWRkcmVzcyI6IjB4NzQyZDM1Y2M2NjM0YzA1MzI5MjVhM2I4NDRiYzllNzU5NWYxZWEyYyIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxODAwMDAwMDAwfQ.mock-signature",
};

const round = (value, digits = 1) => +Number(value).toFixed(digits);

async function processCpu(browserCdp) {
  const { processInfo } = await browserCdp.send("SystemInfo.getProcessInfo");
  const byType = {};
  for (const info of processInfo) byType[info.type] = (byType[info.type] ?? 0) + info.cpuTime;
  return byType;
}

const sumValues = (object) => Object.values(object).reduce((total, value) => total + value, 0);

async function pageMetrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

function quadArea(clip) {
  if (!Array.isArray(clip) || clip.length < 8) return 0;
  const clamp = (value, max) => Math.min(Math.max(value, 0), max);
  const xs = [clip[0], clip[2], clip[4], clip[6]].map((x) => clamp(x, VIEWPORT.width));
  const ys = [clip[1], clip[3], clip[5], clip[7]].map((y) => clamp(y, VIEWPORT.height));
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

/** Pulls the load-cost figures out of a Chromium trace. */
export function summarizeTrace(events) {
  let rendererMain = null;
  for (const event of events) {
    if (event.name === "thread_name" && event.args?.name === "CrRendererMain") {
      // Several renderers can be alive; the one with the most work is the page.
      rendererMain ??= new Map();
      rendererMain.set(`${event.pid}:${event.tid}`, 0);
    }
  }
  const tasksByThread = new Map();
  const summary = {
    paints: 0,
    paintedViewports: 0,
    imageDecodes: 0,
    imageDecodeMs: 0,
    rasterMs: 0,
    frames: 0,
    frameMs: 0,
    evaluateScriptMs: 0,
    layoutMs: 0,
    styleMs: 0,
    paintMs: 0,
  };
  for (const event of events) {
    if (event.ph !== "X") continue;
    const dur = (event.dur ?? 0) / 1000;
    const key = `${event.pid}:${event.tid}`;
    switch (event.name) {
      case "RunTask":
        if (rendererMain?.has(key)) {
          if (!tasksByThread.has(key)) tasksByThread.set(key, []);
          tasksByThread.get(key).push(dur);
        }
        break;
      case "Paint":
        summary.paints += 1;
        summary.paintMs += dur;
        summary.paintedViewports += quadArea(event.args?.data?.clip) / (VIEWPORT.width * VIEWPORT.height);
        break;
      case "Decode Image":
      case "ImageDecodeTask":
        summary.imageDecodes += 1;
        summary.imageDecodeMs += dur;
        break;
      case "RasterTask":
        summary.rasterMs += dur;
        break;
      case "Display::DrawAndSwap":
        summary.frames += 1;
        summary.frameMs += dur;
        break;
      case "EvaluateScript":
      case "v8.compile":
      case "v8.compileModule":
        summary.evaluateScriptMs += dur;
        break;
      case "Layout":
        summary.layoutMs += dur;
        break;
      case "UpdateLayoutTree":
        summary.styleMs += dur;
        break;
      default:
        break;
    }
  }
  let tasks = [];
  for (const list of tasksByThread.values()) {
    if (list.reduce((a, b) => a + b, 0) > tasks.reduce((a, b) => a + b, 0)) tasks = list;
  }
  const longTasks = tasks.filter((dur) => dur > 50);
  return {
    mainThreadMs: round(tasks.reduce((a, b) => a + b, 0)),
    longTasks: longTasks.length,
    longTaskMs: round(longTasks.reduce((a, b) => a + b, 0)),
    tbtMs: round(longTasks.reduce((a, b) => a + (b - 50), 0)),
    longestTaskMs: round(Math.max(0, ...tasks)),
    paints: summary.paints,
    paintMs: round(summary.paintMs),
    paintedViewports: round(summary.paintedViewports),
    imageDecodes: summary.imageDecodes,
    imageDecodeMs: round(summary.imageDecodeMs),
    rasterMs: round(summary.rasterMs),
    frames: summary.frames,
    frameMs: round(summary.frameMs),
    evaluateScriptMs: round(summary.evaluateScriptMs),
    layoutMs: round(summary.layoutMs),
    styleMs: round(summary.styleMs),
  };
}

async function domSnapshot(page) {
  return page.evaluate(() => {
    const all = document.querySelectorAll("*");
    let blurred = 0;
    let blurredArea = 0;
    for (const el of all) {
      const style = getComputedStyle(el);
      const filter = style.backdropFilter || style.webkitBackdropFilter;
      if (filter && filter !== "none") {
        const rect = el.getBoundingClientRect();
        const w = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
        const h = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
        if (w * h > 0) {
          blurred += 1;
          blurredArea += w * h;
        }
      }
    }
    const images = Array.from(document.images).filter((img) => img.complete && img.naturalWidth > 0);
    return {
      domNodes: all.length,
      documentHeight: document.documentElement.scrollHeight,
      infiniteAnimations: document
        .getAnimations()
        .filter((a) => a.playState === "running" && a.effect?.getTiming().iterations === Infinity).length,
      blurredSurfacesInView: blurred,
      blurredViewports: +(blurredArea / (innerWidth * innerHeight)).toFixed(2),
      imagesLoaded: images.length,
      imageMegapixels: +(images.reduce((sum, img) => sum + img.naturalWidth * img.naturalHeight, 0) / 1e6).toFixed(1),
    };
  });
}

async function measureOnce(browser, context, browserCdp, route) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (COLD) {
    await cdp.send("Network.enable");
    await cdp.send("Network.clearBrowserCache");
  }
  if (CPU_SLOWDOWN > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  if (INJECT_CSS) {
    await page.addInitScript((css) => {
      const add = () => {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
      };
      if (document.head) add();
      else {
        new MutationObserver((_, observer) => {
          if (!document.head) return;
          observer.disconnect();
          add();
        }).observe(document, { childList: true, subtree: true });
      }
    }, INJECT_CSS);
  }
  const requests = {};
  page.on("request", (request) => {
    const type = request.resourceType();
    requests[type] = (requests[type] ?? 0) + 1;
  });

  await browser.startTracing(page, {
    categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8", "viz", "cc", "toplevel"],
  });
  const cpuStart = await processCpu(browserCdp);
  const samples = [];
  let last = { at: Date.now(), cpu: sumValues(cpuStart) };
  const sampler = setInterval(async () => {
    try {
      const cpu = sumValues(await processCpu(browserCdp));
      const at = Date.now();
      samples.push({ cores: (cpu - last.cpu) / ((at - last.at) / 1000), cpu: cpu - last.cpu, at });
      last = { at, cpu };
    } catch {
      /* browser closing */
    }
  }, SAMPLE_MS);

  const t0 = Date.now();
  await page.goto(`${BASE_URL}${route}`, { waitUntil: "commit" });
  await page.waitForTimeout(Math.max(0, WINDOW_MS - (Date.now() - t0)));
  clearInterval(sampler);
  const wallMs = Date.now() - t0;
  const cpuEnd = await processCpu(browserCdp);
  const metrics = await pageMetrics(cdp);
  const trace = JSON.parse((await browser.stopTracing()).toString("utf8"));
  const events = Array.isArray(trace) ? trace : trace.traceEvents ?? [];
  const dom = await domSnapshot(page);
  const vitals = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadMs: nav ? Math.round(nav.loadEventEnd) : null,
    };
  });

  // Peak over a 500 ms window (two samples), in cores.
  let peak = 0;
  for (let i = 1; i < samples.length; i += 1) peak = Math.max(peak, (samples[i].cores + samples[i - 1].cores) / 2);

  // CPU seconds spent in each second after navigation started: the burst is
  // the first two, the rest is what the page costs once it is up.
  const cpuBySecond = {};
  for (let second = 1; second <= Math.ceil(WINDOW_MS / 1000); second += 1) cpuBySecond[`s${second}`] = 0;
  for (const sample of samples) {
    const key = `s${Math.max(1, Math.ceil((sample.at - t0) / 1000))}`;
    if (key in cpuBySecond) cpuBySecond[key] += sample.cpu;
  }
  for (const key of Object.keys(cpuBySecond)) cpuBySecond[key] = round(cpuBySecond[key], 2);

  const cpuByProcess = {};
  for (const type of new Set([...Object.keys(cpuStart), ...Object.keys(cpuEnd)])) {
    cpuByProcess[type] = round((cpuEnd[type] ?? 0) - (cpuStart[type] ?? 0), 2);
  }
  const result = {
    route,
    windowMs: wallMs,
    cpuSeconds: round(sumValues(cpuByProcess), 2),
    cpuByProcess,
    cpuBySecond,
    peakCores: round(peak, 2),
    scriptMs: round((metrics.ScriptDuration ?? 0) * 1000),
    ...summarizeTrace(events),
    ...vitals,
    ...dom,
    requests: sumValues(requests),
    requestsByType: requests,
  };
  await page.close();
  return result;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Field-by-field median across runs, so one noisy run does not pick the row. */
function medianRun(runs) {
  const out = {};
  for (const [key, value] of Object.entries(runs[0])) {
    if (typeof value === "number") out[key] = median(runs.map((run) => run[key] ?? 0));
    else if (value && typeof value === "object") {
      out[key] = {};
      for (const inner of new Set(runs.flatMap((run) => Object.keys(run[key] ?? {})))) {
        out[key][inner] = median(runs.map((run) => run[key]?.[inner] ?? 0));
      }
    } else out[key] = value;
  }
  return out;
}

async function main() {
  const api = MOCK_API ? await startHomeLoadMockApi({ port: API_PORT }) : null;
  let browser = null;
  const results = {
    baseUrl: BASE_URL,
    mockApi: MOCK_API,
    signedIn: SIGNED_IN,
    cold: COLD,
    cpuSlowdown: CPU_SLOWDOWN,
    injectedCss: INJECT_CSS || undefined,
    windowMs: WINDOW_MS,
    runs: RUNS,
    at: new Date().toISOString(),
    routes: [],
  };
  try {
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
    const context = await browser.newContext({ viewport: VIEWPORT, baseURL: BASE_URL });
    if (SIGNED_IN) {
      await context.addInitScript((auth) => {
        localStorage.setItem("resonate.token", auth.token);
        localStorage.setItem("resonate.address", auth.address);
        localStorage.setItem("resonate.mock_auth", "true");
        // The consent banner is a first-visit surface; a returning listener has answered it.
      }, MOCK_AUTH);
    }
    const browserCdp = await browser.newBrowserCDPSession();

    // Prime: fill the HTTP and image-optimizer caches and leave a track in the
    // player, paused, as a returning listener has.
    const prime = await context.newPage();
    if (MOCK_API) {
      await prime.goto(`${BASE_URL}/player?trackId=${MOCK_TRACK_ID}`, { waitUntil: "load" });
      await prime.waitForTimeout(2500);
      const pause = prime.locator(".app-player").getByRole("button", { name: /^pause$/i });
      if (await pause.count()) await pause.first().click().catch(() => undefined);
      await prime.evaluate(() => document.querySelectorAll("audio").forEach((audio) => audio.pause()));
      await prime.waitForTimeout(500);
    }
    for (const route of ROUTES) {
      await prime.goto(`${BASE_URL}${route}`, { waitUntil: "load" });
      await prime.waitForTimeout(4000);
      // Scroll through once so lazy images below the fold are in the optimizer cache too.
      await prime.evaluate(async () => {
        const scroller = document.querySelector(".app-content") ?? document.scrollingElement;
        for (let y = 0; y < scroller.scrollHeight; y += 600) {
          scroller.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        scroller.scrollTo(0, 0);
      });
      await prime.waitForTimeout(1500);
      if (SCREENSHOT_DIR) {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
        const name = route === "/" ? "home" : route.replace(/\W+/g, "-").replace(/^-|-$/g, "");
        await prime.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), animations: "disabled" });
      }
    }
    await prime.close();

    for (const route of ROUTES) {
      const runs = [];
      for (let i = 0; i < RUNS; i += 1) {
        runs.push(await measureOnce(browser, context, browserCdp, route));
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      results.routes.push({ route, median: medianRun(runs), runs });
      console.log(`measured ${route} (${RUNS} runs)`);
    }
    await context.close();
  } finally {
    await browser?.close();
    await api?.close();
  }

  console.log(`\nFirst ${WINDOW_MS / 1000} s after opening, median of ${RUNS} runs${COLD ? ", cold cache" : ", warm cache"}${CPU_SLOWDOWN > 1 ? `, ${CPU_SLOWDOWN}× CPU slowdown` : ""}`);
  console.table(
    results.routes.map(({ median: m }) => ({
      route: m.route,
      "CPU s (all processes)": m.cpuSeconds,
      "peak cores": m.peakCores,
      "main thread ms": m.mainThreadMs,
      "script ms": m.scriptMs,
      "style ms": m.styleMs,
      "layout ms": m.layoutMs,
      "TBT ms": m.tbtMs,
      "longest task ms": m.longestTaskMs,
    })),
  );
  console.table(
    results.routes.map(({ median: m }) => ({
      route: m.route,
      paints: m.paints,
      "viewports painted": m.paintedViewports,
      "raster ms": m.rasterMs,
      "image decodes": m.imageDecodes,
      "decode ms": m.imageDecodeMs,
      frames: m.frames,
      "frame ms total": m.frameMs,
      "DOM nodes": m.domNodes,
      "images (MP)": `${m.imagesLoaded} (${m.imageMegapixels})`,
      "blur surfaces (viewports)": `${m.blurredSurfacesInView} (${m.blurredViewports})`,
      "inf. anims": m.infiniteAnimations,
      requests: m.requests,
    })),
  );
  for (const { median: m } of results.routes) {
    console.log(`${m.route} CPU seconds by process:`, m.cpuByProcess, "by second:", m.cpuBySecond, "requests:", m.requestsByType);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = results.at.replace(/[:.]/g, "-");
  const json = JSON.stringify(results, null, 2);
  fs.writeFileSync(path.join(OUT_DIR, `load-${stamp}.json`), json);
  fs.writeFileSync(path.join(OUT_DIR, "load-latest.json"), json);
  console.log(`\nWrote ${path.join(OUT_DIR, "load-latest.json")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
