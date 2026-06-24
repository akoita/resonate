"use strict";

import { test, expect } from "@playwright/test";

// Disable the time-based home auto-rotation (honors prefers-reduced-motion) so
// the featured-hero assertion stays deterministic.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("home hero renders", async ({ page }) => {
  await page.goto("/");
  // Post-Stitch home lead section (#646). Pin to a stable visible label.
  const hero = page.locator(".ng-hero:visible", { hasText: "SennaRin in Paris" }).first();
  await expect(hero).toBeVisible();
});

test("wallet page renders", async ({ page }) => {
  await page.goto("/wallet");
  await expect(page.getByText("Smart Account Balance")).toBeVisible();
});

test("wallet recovery panel renders", async ({ page }) => {
  await page.goto("/wallet");
  await expect(page.getByText("Security & Recovery")).toBeVisible();
});

test("player controls visible", async ({ page }) => {
  await page.goto("/player");
  // Use specific selectors to avoid matching multiple elements
  await expect(page.getByRole("main").getByRole("button", { name: "Play" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Prev" })).toBeVisible();
});
