import { test, expect } from "@playwright/test";

/*
 * Cross-viewport smoke test for #557.
 * Runs on chromium / chromium-tablet / chromium-mobile (see playwright.config).
 * Goal: prove the app renders without horizontal overflow and that the
 * phone drawer nav actually works — not to re-run every per-flow spec
 * against three viewports (that would triple CI time).
 *
 * `mode: serial` — under parallel workers + a single Next.js dev server,
 * the first-compile queue + React hydration race can swallow hamburger
 * clicks. Running these tests serially within each project removes the
 * race; they still parallelize across the 3 viewport projects. Retries
 * further guard against the rare compile-burst that can still nuke a
 * click under heavy CI load.
 */
test.describe.configure({ mode: "serial", retries: 2 });

const ROUTES = ["/", "/library", "/marketplace", "/wallet"] as const;

for (const route of ROUTES) {
  test(`no horizontal overflow at ${route}`, async ({ page }) => {
    await page.goto(route);
    // Let layout settle — some pages lazy-load content.
    await page.waitForLoadState("domcontentloaded");

    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
}

test("phone hamburger opens the sidebar drawer", async ({ page, viewport }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-mobile", "phone-only check");
  expect(viewport?.width ?? 0).toBeLessThan(768);

  await page.goto("/");
  // Wait for React hydration: under parallel dev-server load the initial
  // HTML arrives before the handlers are attached, so early clicks no-op.
  await page.waitForLoadState("networkidle");
  const hamburger = page.getByRole("button", { name: /open navigation/i });
  await expect(hamburger).toBeVisible();

  const drawerLink = page.getByRole("link", { name: "Library" });
  const backdrop = page.locator(".sidebar-backdrop");
  // Click-retry pattern immune to hydration race under heavy parallel
  // worker load. Hamburger toggles, so only click when drawer is closed.
  // Dispatching via `el.click()` avoids pointer/tap event quirks under
  // touch emulation.
  await expect(async () => {
    if ((await backdrop.count()) === 0) {
      await hamburger.evaluate((el) => (el as HTMLElement).click());
    }
    await expect(drawerLink).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 25000 });
});

test("desktop hides the hamburger", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "desktop-only check");

  await page.goto("/");
  const hamburger = page.getByRole("button", { name: /open navigation/i });
  await expect(hamburger).toBeHidden();
});

test("tablet collapses sidebar labels (icon-only rail)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-tablet", "tablet-only check");

  await page.goto("/");
  // Sidebar renders, but the label text is hidden by the tablet media query.
  const homeLabel = page.locator(".app-sidebar .link-text", { hasText: "Home" });
  await expect(homeLabel).toBeAttached();
  await expect(homeLabel).toBeHidden();
});

test("phone backdrop click closes the drawer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-mobile", "phone-only check");

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const hamburger = page.getByRole("button", { name: /open navigation/i });
  await expect(hamburger).toBeVisible();

  const backdrop = page.locator(".sidebar-backdrop");
  // Click-and-verify retry loop. Under parallel worker load the first
  // click can land before React has finished attaching its handler even
  // after `networkidle`, and the state toggle is lost. The hamburger
  // toggles (not opens), so blind retries would alternate open/close —
  // only click if the drawer isn't already open. On touch-emulated
  // mobile, dispatch the click directly on the element so we bypass
  // the pointer/tap flow entirely.
  await expect(async () => {
    if ((await backdrop.count()) === 0) {
      await hamburger.evaluate((el) => (el as HTMLElement).click());
    }
    await expect(backdrop).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 25000 });

  // The backdrop uses `position: fixed; inset: 0;` so it spans the whole
  // viewport, but the drawer sits on top of its left portion. Clicking
  // the geometric center would hit a drawer sidebar link. Dispatch the
  // click directly to the backdrop element — this is what the user
  // effectively does when tapping the visible-to-them scrim area.
  await backdrop.evaluate((el) => (el as HTMLElement).click());
  await expect(backdrop).toHaveCount(0);
  // Sidebar drawer itself should slide off-screen (lose its .open class).
  await expect(page.locator(".app-sidebar.open")).toHaveCount(0);
});
