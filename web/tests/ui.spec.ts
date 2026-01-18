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
