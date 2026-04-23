import { test, expect } from "@playwright/test";

/*
 * Shows wedge smoke — home page leads with the featured campaign, the
 * CTA lands on a real detail page (not a 404), sidebar exposes the
 * Shows nav with a "NEW" pill. Covered on chromium-desktop only; the
 * existing responsive.spec.ts already covers no-horizontal-overflow
 * across all three viewport projects.
 */

test.describe.configure({ mode: "serial", retries: 2 });

test("home page leads with the Sennarin campaign hero and its CTA", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  const hero = page.locator(".campaign-hero").first();
  await expect(hero).toBeVisible();

  await expect(hero.getByText("Sennarin in Paris")).toBeVisible();
  await expect(hero.getByText(/Featured Show/i)).toBeVisible();

  // The progress bar has a valid aria progressbar exposed.
  await expect(hero.getByRole("progressbar")).toBeVisible();

  // Trust-signal ghost button points at Sepolia Etherscan.
  const escrowLink = hero.getByRole("link", { name: /escrow contract/i });
  await expect(escrowLink).toHaveAttribute(
    "href",
    /sepolia\.etherscan\.io\/address\/0x/,
  );

  // Primary CTA navigates to the detail page.
  const cta = hero.getByRole("link", { name: /send your signal/i });
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

test("/shows explorer renders all three campaign cards", async ({ page }) => {
  await page.goto("/shows");
  await page.waitForLoadState("domcontentloaded");

  await expect(page.getByRole("heading", { name: /Fans bring the show/i })).toBeVisible();
  await expect(page.locator(".campaign-card")).toHaveCount(3);
});

test("/shows/sennarin-paris detail stub renders hero + how-it-works + cohort notice (not a dead button)", async ({ page }) => {
  await page.goto("/shows/sennarin-paris");
  await page.waitForLoadState("domcontentloaded");

  await expect(page.locator(".campaign-hero")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Three steps/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Pledging launches/i })).toBeVisible();
});
