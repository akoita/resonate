"use strict";

import { test, expect } from "@playwright/test";

test("shows connect wallet call-to-action", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Connect wallet")).toBeVisible();
});

test("hides embedded wallet option when disabled", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Use embedded wallet")).toHaveCount(0);
});

test("shows self-custody actions panel", async ({ page }) => {
  await page.goto("/wallet");
  await expect(page.getByText("Self-custody actions")).toBeVisible();
});

test("sidebar navigation works", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Player" }).click();
  await expect(page.getByText("Now playing")).toBeVisible();
  await page.getByRole("link", { name: "Upload" }).click();
  await expect(page.getByText("Upload your track")).toBeVisible();
  await page.getByRole("link", { name: "Analytics" }).click();
  await expect(page.getByText("Artist Analytics")).toBeVisible();
});
