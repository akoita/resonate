import { test, expect } from "@playwright/test";

/*
 * Cross-viewport smoke test for #557.
 * Runs on chromium / chromium-tablet / chromium-mobile (see playwright.config).
 * Goal: prove the app renders without horizontal overflow and that the
 * phone drawer nav actually works — not to re-run every per-flow spec
 * against three viewports (that would triple CI time).
 */

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
  const hamburger = page.getByRole("button", { name: /open navigation/i });
  await expect(hamburger).toBeVisible();

  await hamburger.click();
  // Once open, at least one primary nav link should be reachable inside the drawer.
  await expect(page.getByRole("link", { name: "Library" })).toBeVisible();
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
  const hamburger = page.getByRole("button", { name: /open navigation/i });
  await hamburger.click();

  const backdrop = page.locator(".sidebar-backdrop");
  await expect(backdrop).toBeVisible();

  await backdrop.click();
  await expect(backdrop).toHaveCount(0);
  // Sidebar drawer itself should slide off-screen (lose its .open class).
  await expect(page.locator(".app-sidebar.open")).toHaveCount(0);
});
