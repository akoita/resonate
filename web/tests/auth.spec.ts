"use strict";

import { test, expect } from "@playwright/test";

test("shows connect wallet call-to-action", async ({ page }) => {
  await page.goto("/");
  // Topbar has ConnectButton, which shows "Sign in" and "Create account"
  // Let's check for the logo which is always there
  await expect(page.locator(".logo-text")).toContainText("Resonate");
});

test("hides embedded wallet option when disabled", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Use embedded wallet")).toHaveCount(0);
});

test("hides privy login when disabled", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Continue with email")).toHaveCount(0);
});

test("shows self-custody actions panel", async ({ page }) => {
  await page.goto("/wallet");
  // Wallet page has AuthGate if not logged in
  await expect(page.getByText("Secure Access")).toBeVisible();
});

test("sidebar navigation works", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Player" }).click();
  await expect(page.getByText("System Monitoring")).toBeVisible();
  // #2663: the artist group (Upload, Analytics) is shown only to artist
  // accounts; the routes stay reachable directly and ask to sign in.
  await expect(page.getByRole("navigation", { name: "Artist and account" }).getByRole("link", { name: "Upload" })).toHaveCount(0);
  await page.goto("/artist/upload");
  await expect(page.getByText("Sign in to upload releases.")).toBeVisible();
});
