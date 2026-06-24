import { test, expect } from "@playwright/test";

/*
 * Shows wedge smoke — home page leads with the featured campaign, the
 * CTA lands on a real detail page (not a 404), sidebar exposes the
 * Shows nav with a "NEW" pill. Covered on chromium-desktop only; the
 * existing responsive.spec.ts already covers no-horizontal-overflow
 * across all three viewport projects.
 */

test.describe.configure({ mode: "serial", retries: 2 });

test("home hero features the SennaRin campaign and links to its detail page", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  // Stitch-designed hero (amber/purple mesh, glass card).
  const hero = page.locator(".ng-hero").first();
  await expect(hero).toBeVisible();
  await expect(hero.locator(".ng-hero__title")).toHaveText("SennaRin in Paris");
  await expect(hero.getByText(/Featured Campaign/i)).toBeVisible();

  // Primary CTA navigates to the campaign detail page.
  const cta = hero.getByRole("link", { name: /listen now/i });
  await expect(cta).toHaveAttribute("href", "/shows/sennarin-paris");
});

test("sidebar exposes a Shows nav entry with a NEW pill", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  const showsLink = page.locator(".app-sidebar").getByRole("link", { name: /Shows/ }).first();
  await expect(showsLink).toBeVisible();
  await expect(showsLink.locator(".sidebar-link__new")).toHaveText("NEW");
  await expect(showsLink).toHaveAttribute("href", "/shows");
});

test("/shows explorer renders all four campaign cards", async ({ page }) => {
  await page.goto("/shows");
  await page.waitForLoadState("domcontentloaded");

  await expect(page.getByRole("heading", { name: /Fans bring the show/i })).toBeVisible();
  await expect(page.locator(".campaign-card")).toHaveCount(4);
});

test("/shows/sennarin-paris detail stub renders hero + how-it-works + cohort notice (not a dead button)", async ({ page }) => {
  await page.goto("/shows/sennarin-paris");
  await page.waitForLoadState("domcontentloaded");

  const hero = page.locator(".campaign-hero:visible", { hasText: "SennaRin in Paris" }).first();
  await expect(hero).toBeVisible();
  await expect(page.getByRole("heading", { name: /Three steps/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Pledging follows the live escrow/i })).toBeVisible();
});
