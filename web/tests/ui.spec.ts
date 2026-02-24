"use strict";

import { test, expect } from "@playwright/test";

test("home hero renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Latest Masterings")).toBeVisible();
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
