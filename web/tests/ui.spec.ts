"use strict";

import { test, expect } from "@playwright/test";

test("home hero renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Resonate")).toBeVisible();
});

test("wallet page renders", async ({ page }) => {
  await page.goto("/wallet");
  await expect(page.getByText("Wallet Overview")).toBeVisible();
});

test("player has social share panel", async ({ page }) => {
  await page.goto("/player");
  await expect(page.getByText("Share this track")).toBeVisible();
});
