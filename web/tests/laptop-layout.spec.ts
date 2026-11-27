import { test, expect, type Page } from "@playwright/test";
import { guideSeedResponse } from "./fixtures/guide-seed-mock.mjs";

/*
 * Laptop layout guard. On a laptop the page column is the window minus the
 * sidebar and, while something plays, the Session Dock, so a layout keyed to
 * the window width squeezed text to a word per line or stacked one block over
 * another (the Home campaign list over the featured card, the Tune in card,
 * Settings sources, the Shows create form).
 *
 * At the common laptop widths, with the dock open and the sidebar expanded,
 * each page below must have no text squeezed to a word per line, no text
 * drawn over other text, and no sideways scroll of the page itself.
 */
test.describe.configure({ mode: "serial" });

const API = process.env.E2E_API_URL ?? "http://localhost:3000";
const LAPTOP_WIDTHS = [1280, 1366, 1440, 1536] as const;
const ROUTES = [
  "/",
  "/library",
  "/crates",
  "/create",
  "/drops",
  "/shows",
  "/shows/create",
  "/settings",
  "/support",
  "/artist/catalog",
  "/release/e2e-release-000-0000-0000-000000000001",
] as const;
const E2E_USER = "e2e-user-00000000-0000-0000-0000-000000000001";

type LayoutReport = { squeezed: string[]; overlapping: string[]; sideways: number; widest: string[] };

/** Runs in the page: finds squeezed, overlapping and sideways-scrolling content. */
function measureLayout(): LayoutReport {
  const report: LayoutReport = { squeezed: [], overlapping: [], sideways: 0, widest: [] };
  const page = document.querySelector(".app-page");
  const content = document.querySelector(".app-content");
  if (!page || !content) return report;
  report.sideways = Math.max(0, content.scrollWidth - content.clientWidth);
  if (report.sideways > 2) {
    // Name what reaches past the page column, so a failure says where to look.
    const edge = content.getBoundingClientRect().right;
    for (const element of page.querySelectorAll("*")) {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.right > edge + 1) {
        const label = typeof element.className === "string" ? element.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
        report.widest.push(`${element.tagName.toLowerCase()}${label ? `.${label}` : ""} (right edge ${Math.round(box.right - edge)}px past the column)`);
      }
    }
    report.widest = report.widest.slice(-4);
  }

  const visible = (element: Element) => {
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") return false;
    let opacity = 1;
    for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return opacity > 0.05;
  };
  const inOverlay = (element: Element) => {
    for (let node: Element | null = element; node && node !== page; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") return true;
    }
    return Boolean(element.closest("[role=dialog], [aria-hidden='true']"));
  };
  const name = (element: Element) =>
    typeof element.className === "string" && element.className.trim()
      ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : element.tagName.toLowerCase();

  type Box = { left: number; top: number; right: number; bottom: number };
  const texts: Array<{ element: Element; text: string; lines: Box[] }> = [];
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = (node.textContent ?? "").trim();
    const element = node.parentElement;
    if (!text || !element || !visible(element) || inOverlay(element)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    // Clip to every clipping ancestor (line clamps, carousels, scrollers).
    let clip: Box = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    for (let ancestor: Element | null = element; ancestor && ancestor !== page; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.overflowX === "visible" && style.overflowY === "visible") continue;
      const box = ancestor.getBoundingClientRect();
      clip = {
        left: Math.max(clip.left, box.left),
        top: Math.max(clip.top, box.top),
        right: Math.min(clip.right, box.right),
        bottom: Math.min(clip.bottom, box.bottom),
      };
    }
    const lines = [...range.getClientRects()]
      .map((rect) => ({
        left: Math.max(rect.left, clip.left),
        top: Math.max(rect.top, clip.top),
        right: Math.min(rect.right, clip.right),
        bottom: Math.min(rect.bottom, clip.bottom),
      }))
      .filter((box) => box.right - box.left > 0 && box.bottom - box.top > 0);
    if (lines.length === 0) continue;

    const lineCount = new Set(lines.map((box) => Math.round(box.top / 4))).size;
    const words = text.split(/\s+/).length;
    const width = range.getBoundingClientRect().width;
    if (lineCount >= 3 && (lineCount >= words * 0.7 || width < 70)) {
      report.squeezed.push(`${name(element)} "${text.slice(0, 40)}" (${lineCount} lines, ${Math.round(width)}px wide)`);
    }
    texts.push({ element, text, lines });
  }

  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      const a = texts[i];
      const b = texts[j];
      if (a.element === b.element || a.element.contains(b.element) || b.element.contains(a.element)) continue;
      const hit = a.lines.some((p) =>
        b.lines.some((q) => {
          const x = Math.min(p.right, q.right) - Math.max(p.left, q.left);
          const y = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
          return x > 4 && y > Math.min(p.bottom - p.top, q.bottom - q.top) * 0.5;
        }),
      );
      if (hit) report.overlapping.push(`${name(a.element)} "${a.text.slice(0, 30)}" × ${name(b.element)} "${b.text.slice(0, 30)}"`);
    }
  }
  return report;
}

async function dismissPrompts(page: Page) {
  for (const label of ["No, do not measure", "Got it", "Not now"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    if (await button.count()) await button.first().click().catch(() => undefined);
  }
}

/** A queue in the player store, so the Session Dock opens on every page. */
async function seedQueue(page: Page) {
  // The player writes its own (empty) state once it has hydrated; seed after
  // that write so the seeded queue is the one that stays.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const open = indexedDB.open("resonate");
              open.onerror = () => resolve(false);
              open.onsuccess = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains("player")) return resolve(false);
                const get = db.transaction("player").objectStore("player").get("current_state");
                get.onsuccess = () => resolve(get.result != null);
                get.onerror = () => resolve(false);
              };
            }),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.evaluate(async () => {
    const queue = ["a", "b"].map((id) => ({
      id, catalogTrackId: id, title: `Laptop check ${id}`, artist: "Test Artist", album: null, albumArtist: null,
      genre: null, year: null, duration: 30, createdAt: "", source: "remote", remoteUrl: `${location.origin}/t-${id}.wav`,
    }));
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("resonate");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("player")) return resolve();
        const tx = db.transaction("player", "readwrite");
        tx.objectStore("player").put(
          { queue, currentIndex: 0, volume: 0.5, shuffle: false, repeatMode: "none", queueSource: null },
          "current_state",
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}

for (const width of LAPTOP_WIDTHS) {
  test(`pages keep their layout at ${width}px with the Session Dock open`, async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: 860 });

    const login = await request.post(`${API}/auth/login`, { data: { userId: E2E_USER, role: "artist" } });
    expect(login.ok()).toBeTruthy();
    const { accessToken } = await login.json();
    await page.addInitScript((token) => {
      localStorage.setItem("resonate.token", token);
      localStorage.setItem("resonate.address", "0x1234567890abcdef1234567890abcdef12345678");
    }, accessToken);
    // Four live campaigns, so Home shows its featured card beside the campaign list.
    await page.route(/:3000\/(shows\/campaigns(\/[^/?]+)?|guide-art\/[^/?]+)(\?|$)/, (route) => {
      const response = guideSeedResponse(route.request().method(), new URL(route.request().url()));
      return route.fulfill({ status: response.status, contentType: response.type, body: response.body });
    });

    await page.goto("/library");
    await page.waitForLoadState("networkidle");
    await seedQueue(page);

    const problems: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await dismissPrompts(page);
      await expect(page.locator("#session-dock")).toBeVisible();
      const report = await page.evaluate(measureLayout);
      for (const item of report.squeezed) problems.push(`${route}: squeezed ${item}`);
      for (const item of report.overlapping) problems.push(`${route}: overlapping ${item}`);
      if (report.sideways > 2) problems.push(`${route}: the page scrolls sideways by ${report.sideways}px; widest: ${report.widest.join(", ") || "a pseudo-element or transform"}`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
}
