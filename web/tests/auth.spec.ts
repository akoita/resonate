"use strict";

import { test, expect } from "@playwright/test";

test("shows connect wallet call-to-action", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Connect wallet")).toBeVisible();
});

test("shows self-custody actions panel", async ({ page }) => {
  await page.goto("/wallet");
  await expect(page.getByText("Self-custody actions")).toBeVisible();
});
