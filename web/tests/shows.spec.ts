import { test, expect } from "@playwright/test";

/*
 * Shows wedge smoke — home page leads with the featured campaign, the
 * CTA lands on a real detail page (not a 404), sidebar exposes the
 * Shows nav with a "NEW" pill. Covered on chromium-desktop only; the
 * existing responsive.spec.ts already covers no-horizontal-overflow
 * across all three viewport projects.
 *
 * Campaigns come from the real backend: global-setup loads the five sample
 * show fixtures (backend `fixtures:shows`) so these specs exercise the API
 * path — the web app no longer substitutes sample data for an empty list.
 */

test.describe.configure({ mode: "serial", retries: 2 });

// Disable the time-based featured-hero / event-row auto-rotation (it honors
// prefers-reduced-motion) so the featured-campaign assertions are deterministic.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("home hero features the SennaRin campaign and links to its detail page", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  // Stitch-designed hero (amber/purple mesh, glass card), fed by the real
  // sample show fixtures loaded in global-setup (#1869). Which campaign leads
  // follows the live ranking, so select SennaRin from the hero rail.
  const hero = page.locator(".ng-hero").first();
  await expect(hero).toBeVisible();
  await expect(hero.getByText(/Featured Campaign/i)).toBeVisible();
  const tab = hero
    .locator(".ng-hero__campaign-rail")
    .getByRole("button", { name: /SennaRin in Paris/ });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-pressed", "true");
  await expect(hero.locator(".ng-hero__title")).toHaveText("SennaRin in Paris");

  // Primary CTA navigates to the campaign detail page.
  const cta = hero.getByRole("link", { name: /back this show/i });
  await expect(cta).toHaveAttribute("href", "/shows/sennarin-paris");
});

test("home hero shows an honest empty state when no campaign is open", async ({ page }) => {
  // The API answers successfully with no campaigns: the hero must not fall
  // back to built-in sample campaigns (#1869).
  await page.route(
    (url) => url.pathname === "/shows/campaigns" && url.port === "3000",
    (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  const hero = page.locator(".ng-hero--empty");
  await expect(hero).toBeVisible();
  await expect(hero.locator(".ng-hero__title")).toHaveText("Fans bring the show.");
  await expect(hero.getByText(/No campaigns are open for pledges right now/)).toBeVisible();
  await expect(hero.getByRole("link", { name: /Start a campaign/ })).toHaveAttribute("href", "/shows/create");
  await expect(hero.getByRole("link", { name: /Browse shows/ })).toHaveAttribute("href", "/shows");
  await expect(page.locator(".ng-hero").getByText(/Featured Campaign|SennaRin/)).toHaveCount(0);
});

test("sidebar exposes a Shows nav entry with a NEW pill", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  const showsLink = page.locator(".app-sidebar").getByRole("link", { name: /Shows/ }).first();
  await expect(showsLink).toBeVisible();
  await expect(showsLink.locator(".sidebar-link__new")).toHaveText("NEW");
  await expect(showsLink).toHaveAttribute("href", "/shows");
});

test("/shows explorer renders all five campaign cards", async ({ page }) => {
  await page.goto("/shows");
  await page.waitForLoadState("domcontentloaded");

  await expect(page.getByRole("heading", { name: /Fans bring the show/i })).toBeVisible();
  await expect(page.locator(".campaign-card")).toHaveCount(5);
});

test("/shows/sennarin-paris detail renders pledge-module hero + how-it-works + escrow notice", async ({ page }) => {
  await page.goto("/shows/sennarin-paris");
  await page.waitForLoadState("domcontentloaded");

  const hero = page.locator(".campaign-detail-hero:visible", { hasText: "SennaRin in Paris" }).first();
  await expect(hero).toBeVisible();
  // The live pledge module (tiers panel) sits inside the hero, above the fold.
  await expect(hero.locator(".show-detail__pledge-panel")).toBeVisible();
  await expect(hero.getByText(/signal tiers/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Three steps/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Pledging follows the live escrow/i })).toBeVisible();
});
