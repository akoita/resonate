/**
 * Measure what an IDLE Resonate tab costs (#2436).
 *
 * A music app stays open for hours, so "nothing is happening" must be cheap.
 * This harness loads a route, lets it settle, then records a quiet window in
 * which nobody touches the page and reports, per route:
 *
 *   - main-thread busy %  — CDP Performance.getMetrics TaskDuration delta / wall
 *   - script / style / layout work during the window (ms and counts)
 *   - paints/s and painted area/s as a multiple of the viewport — the number
 *     Rendering → "Paint flashing" shows by eye. 1.0×/s means "the equivalent of
 *     one full-viewport repaint every second".
 *   - running infinite animations (document.getAnimations()), split into
 *     on-screen and off-screen targets
 *   - JS heap used at the start and end of the window
 *   - requests, timer callbacks and running infinite animations while the tab
 *     reports `hidden`
 *   - running infinite animations under prefers-reduced-motion: reduce
 *
 * The "hidden" phase overrides document.visibilityState / document.hidden and
 * fires `visibilitychange`. That exercises the app's own visibility guards
 * (polling, rotations); the browser's real background throttling is on top of
 * that and is not simulated.
 *
 * Offline mode (IDLE_MOCK_API=true, the default when targeting localhost) needs
 * only the web app: API calls fail fast so the app falls back to its offline
 * samples, and one mocked track is loaded into the persistent player and left
 * PAUSED, matching the report in #2436 (Home, signed in, player paused).
 *
 * Usage:
 *   # Production build of the web app on :3001 (dev mode skews every number):
 *   NEXT_PUBLIC_MOCK_AUTH=true npm run build && npm start -- -p 3001
 *   npm run perf:idle
 *
 *   IDLE_ROUTES=/,/player IDLE_WINDOW_MS=20000 npm run perf:idle
 *
 * Environment:
 *   IDLE_BASE_URL     target origin (falls back to BASE_URL, then localhost:3001)
 *   IDLE_ROUTES       comma-separated routes (default "/,/player,/library,/shows")
 *   IDLE_SETTLE_MS    quiet time after navigation before measuring (default 6000)
 *   IDLE_WINDOW_MS    measured idle window (default 10000)
 *   IDLE_MOCK_API     "true"/"false"; mock the API offline (default true on localhost)
 *   IDLE_API_ORIGIN   API origin to mock (default http://localhost:3000)
 *   IDLE_SIGNED_IN    "true"/"false"; inject the E2E mock session (default true)
 *   IDLE_OUT_DIR      JSON output directory (default web/build/perf, gitignored)
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE  optional Chromium binary override
 *
 * Caveat: compare numbers only with other runs on the same machine and build.
 * Headless Chromium rasterizes in software, so absolute paint costs are higher
 * than on a GPU laptop; the counts and areas are what transfer.
 */
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.IDLE_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:3001";
const ROUTES = (process.env.IDLE_ROUTES ?? "/,/player,/library,/shows")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);
const SETTLE_MS = Number(process.env.IDLE_SETTLE_MS ?? 6000);
const WINDOW_MS = Number(process.env.IDLE_WINDOW_MS ?? 10000);
const API_ORIGIN = process.env.IDLE_API_ORIGIN ?? "http://localhost:3000";
const MOCK_API =
  (process.env.IDLE_MOCK_API ?? (/localhost|127\.0\.0\.1/.test(BASE_URL) ? "true" : "false")) === "true";
const SIGNED_IN = (process.env.IDLE_SIGNED_IN ?? "true") === "true";
const VIEWPORT = { width: 1440, height: 900 };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.IDLE_OUT_DIR ?? path.resolve(__dirname, "..", "build", "perf");

// Same mock session as tests/auth.setup.ts (not a real credential).
const MOCK_AUTH = {
  address: "0x742d35cc6634c0532925a3b844bc9e7595f1ea2c",
  token:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJyb2xlIjoiYXJ0aXN0IiwiYWRkcmVzcyI6IjB4NzQyZDM1Y2M2NjM0YzA1MzI5MjVhM2I4NDRiYzllNzU5NWYxZWEyYyIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxODAwMDAwMDAwfQ.mock-signature",
};

const MOCK_TRACK_ID = "trk_idle_probe";
const MOCK_RELEASE_ID = "rel_idle_probe";
const MOCK_STEM_ID = "stm_idle_probe";
// Long enough to overflow the player bar, so the title marquee is in play.
const MOCK_TITLE = "Loop And Repeat — An Extended Title That Overflows The Player Bar";

/** 30 s of 8 kHz mono silence, so the player has a real, seekable source. */
function silentWav(seconds = 30, sampleRate = 8000) {
  const dataBytes = seconds * sampleRate;
  const buffer = Buffer.alloc(44 + dataBytes, 0x80);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

async function mockApi(context) {
  const wav = silentWav();
  const stemUri = `${API_ORIGIN}/__idle-probe/${MOCK_STEM_ID}.wav`;
  const release = {
    id: MOCK_RELEASE_ID,
    title: "Idle Probe",
    primaryArtist: "Probe Artist",
    genre: "Electronic",
    status: "published",
    artworkUrl: null,
    tracks: [
      {
        id: MOCK_TRACK_ID,
        title: MOCK_TITLE,
        createdAt: "2026-10-01T00:00:00.000Z",
        stems: [{ id: MOCK_STEM_ID, type: "ORIGINAL", uri: stemUri, durationSeconds: 30 }],
      },
    ],
  };
  await context.route(`${API_ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/__idle-probe/")) {
      return route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
    }
    if (url.pathname === `/catalog/tracks/${MOCK_TRACK_ID}`) {
      return route.fulfill({ json: { id: MOCK_TRACK_ID, title: MOCK_TITLE, releaseId: MOCK_RELEASE_ID } });
    }
    if (url.pathname === `/catalog/releases/${MOCK_RELEASE_ID}`) {
      return route.fulfill({ json: release });
    }
    // Everything else fails like an unreachable API, so the app uses its
    // offline fallbacks (e.g. sample show campaigns) instead of hanging.
    return route.abort("connectionrefused");
  });
}

/** Lets the probe flip document.visibilityState without leaving the page. */
function visibilityShim() {
  const w = window;
  w.__idleProbeHidden = false;
  w.__idleProbeTimerCalls = 0;
  Object.defineProperty(Document.prototype, "visibilityState", {
    configurable: true,
    get: () => (w.__idleProbeHidden ? "hidden" : "visible"),
  });
  Object.defineProperty(Document.prototype, "hidden", {
    configurable: true,
    get: () => Boolean(w.__idleProbeHidden),
  });
  const wrap = (name) => {
    const original = w[name].bind(w);
    w[name] = (handler, ...rest) =>
      original(
        typeof handler === "function"
          ? (...args) => {
              if (w.__idleProbeHidden) w.__idleProbeTimerCalls += 1;
              return handler(...args);
            }
          : handler,
        ...rest,
      );
  };
  wrap("setInterval");
  wrap("setTimeout");
}

/** Area of a Paint event's clip quad, clamped to the viewport. */
function quadArea(clip) {
  if (!Array.isArray(clip) || clip.length < 8) return 0;
  const clamp = (value, max) => Math.min(Math.max(value, 0), max);
  const xs = [clip[0], clip[2], clip[4], clip[6]].map((x) => clamp(x, VIEWPORT.width));
  const ys = [clip[1], clip[3], clip[5], clip[7]].map((y) => clamp(y, VIEWPORT.height));
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

async function metrics(cdp) {
  const { metrics: list } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}

async function animationSnapshot(page) {
  return page.evaluate(() => {
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const running = document
      .getAnimations()
      .filter((a) => a.playState === "running" && a.effect?.getTiming().iterations === Infinity);
    const describe = (a) => {
      const target = a.effect?.target;
      const el = target instanceof Element ? target : null;
      const rect = el?.getBoundingClientRect();
      const onScreen =
        Boolean(rect) &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < viewportH &&
        rect.left < viewportW;
      const cls = el ? (typeof el.className === "string" ? el.className : el.getAttribute("class") ?? "") : "";
      return {
        name: a.animationName ?? a.id ?? "(anonymous)",
        target: el ? `${el.tagName.toLowerCase()}.${cls.trim().split(/\s+/).slice(0, 2).join(".")}` : "(none)",
        onScreen,
      };
    };
    const items = running.map(describe);
    return {
      running: items.length,
      onScreen: items.filter((i) => i.onScreen).length,
      offScreen: items.filter((i) => !i.onScreen).length,
      byName: items.reduce((acc, item) => {
        const key = `${item.name}${item.onScreen ? "" : " (off-screen)"}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    };
  });
}

async function measureIdle(page, cdp, browser, label) {
  await page.waitForTimeout(SETTLE_MS);
  const animations = await animationSnapshot(page);
  const before = await metrics(cdp);
  await browser.startTracing(page, {
    categories: ["devtools.timeline", "disabled-by-default-devtools.timeline"],
  });
  const t0 = Date.now();
  await page.waitForTimeout(WINDOW_MS);
  const traceBuffer = await browser.stopTracing();
  const wallMs = Date.now() - t0;
  const after = await metrics(cdp);
  const trace = JSON.parse(traceBuffer.toString("utf8"));
  const events = Array.isArray(trace) ? trace : trace.traceEvents ?? [];
  let paints = 0;
  let paintArea = 0;
  for (const event of events) {
    if (event.name === "Paint" && event.ph !== "E") {
      paints += 1;
      paintArea += quadArea(event.args?.data?.clip);
    }
  }
  const seconds = wallMs / 1000;
  const delta = (key) => (after[key] ?? 0) - (before[key] ?? 0);
  return {
    label,
    windowMs: wallMs,
    mainThreadBusyPct: +((delta("TaskDuration") / seconds) * 100).toFixed(2),
    scriptMs: +(delta("ScriptDuration") * 1000).toFixed(1),
    styleRecalcs: delta("RecalcStyleCount"),
    styleMs: +(delta("RecalcStyleDuration") * 1000).toFixed(1),
    layouts: delta("LayoutCount"),
    layoutMs: +(delta("LayoutDuration") * 1000).toFixed(1),
    paintsPerSec: +(paints / seconds).toFixed(1),
    viewportsPaintedPerSec: +(paintArea / (VIEWPORT.width * VIEWPORT.height) / seconds).toFixed(2),
    heapStartMB: +((before.JSHeapUsedSize ?? 0) / 1048576).toFixed(1),
    heapEndMB: +((after.JSHeapUsedSize ?? 0) / 1048576).toFixed(1),
    infiniteAnimations: animations,
  };
}

async function measureHidden(page) {
  const requests = [];
  const onRequest = (request) => requests.push(request.url());
  await page.evaluate(() => {
    window.__idleProbeHidden = true;
    window.__idleProbeTimerCalls = 0;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  page.on("request", onRequest);
  await page.waitForTimeout(WINDOW_MS);
  page.off("request", onRequest);
  const runningAnimations = (await animationSnapshot(page)).running;
  const timerCalls = await page.evaluate(() => {
    const calls = window.__idleProbeTimerCalls;
    window.__idleProbeHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    return calls;
  });
  return {
    requests: requests.length,
    requestPaths: [...new Set(requests.map((url) => new URL(url).pathname))].slice(0, 10),
    timerCalls,
    runningAnimations,
  };
}

/** Client-side navigation keeps the player (and its paused track) mounted. */
async function navigate(page, route) {
  const current = new URL(page.url()).pathname;
  if (current === route) return;
  const link = page.locator(`a[href="${route}"]`).first();
  if (await link.count()) {
    await link.click();
    await page.waitForURL((url) => url.pathname === route, { timeout: 30000 });
  } else {
    await page.goto(route, { waitUntil: "load" });
  }
}

async function loadPausedTrack(page) {
  await page.goto(`/player?trackId=${MOCK_TRACK_ID}`, { waitUntil: "load" });
  const bar = page.locator(".app-player");
  await bar.waitFor({ state: "visible", timeout: 30000 });
  // Autoplay may or may not start; leave it paused either way.
  await page.waitForTimeout(1500);
  const pause = bar.getByRole("button", { name: /^pause$/i });
  if (await pause.count()) await pause.first().click();
  await page.evaluate(() => document.querySelectorAll("audio").forEach((audio) => audio.pause()));
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const results = { baseUrl: BASE_URL, mockApi: MOCK_API, signedIn: SIGNED_IN, at: new Date().toISOString(), routes: [] };
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, baseURL: BASE_URL });
    if (MOCK_API) await mockApi(context);
    await context.addInitScript(visibilityShim);
    if (SIGNED_IN) {
      await context.addInitScript((auth) => {
        localStorage.setItem("resonate.token", auth.token);
        localStorage.setItem("resonate.address", auth.address);
        localStorage.setItem("resonate.mock_auth", "true");
      }, MOCK_AUTH);
    }
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");

    if (MOCK_API) await loadPausedTrack(page);
    for (const route of ROUTES) {
      await navigate(page, route);
      const idle = await measureIdle(page, cdp, browser, route);
      const hidden = await measureHidden(page);
      results.routes.push({ ...idle, hidden });
      console.log(`measured ${route}`);
    }

    // Reduced motion: count what still runs once the user opts out of motion.
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const route of ROUTES) {
      await navigate(page, route);
      await page.waitForTimeout(2000);
      const entry = results.routes.find((r) => r.label === route);
      entry.reducedMotion = await animationSnapshot(page);
    }
    await context.close();
  } finally {
    await browser.close();
  }

  console.log("");
  console.table(
    results.routes.map((r) => ({
      route: r.label,
      "busy %": r.mainThreadBusyPct,
      "script ms": r.scriptMs,
      "style recalcs": r.styleRecalcs,
      layouts: r.layouts,
      "paints/s": r.paintsPerSec,
      "viewports/s": r.viewportsPaintedPerSec,
      "inf. anims (on/off)": `${r.infiniteAnimations.onScreen}/${r.infiniteAnimations.offScreen}`,
      "heap MB": `${r.heapStartMB}→${r.heapEndMB}`,
      "hidden req": r.hidden.requests,
      "hidden timers": r.hidden.timerCalls,
      "hidden anims": r.hidden.runningAnimations,
      "reduced-motion anims": r.reducedMotion?.running,
    })),
  );
  for (const r of results.routes) {
    console.log(`\n${r.label} running infinite animations:`, r.infiniteAnimations.byName);
    if (r.reducedMotion?.running) console.log(`${r.label} under reduced motion:`, r.reducedMotion.byName);
    if (r.hidden.requests) console.log(`${r.label} requests while hidden:`, r.hidden.requestPaths);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = results.at.replace(/[:.]/g, "-");
  const json = JSON.stringify(results, null, 2);
  fs.writeFileSync(path.join(OUT_DIR, `idle-${stamp}.json`), json);
  fs.writeFileSync(path.join(OUT_DIR, "idle-latest.json"), json);
  console.log(`\nWrote ${path.join(OUT_DIR, "idle-latest.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
