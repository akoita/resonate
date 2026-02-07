/**
 * @file catalog.spec.ts
 * @description E2E tests for the home page and catalog — runs against the REAL backend.
 *
 * No mocks. The database is seeded by global-setup.ts before the suite starts.
 * Seeded test data includes a published release with track and stems.
 *
 * @requires Postgres running with seeded data
 * @requires Backend on :3000, Frontend on :3001 (auto-started by playwright.config)
 */
"use strict";

import { test, expect } from "@playwright/test";

test.describe("Catalog & Home Page", () => {

    test("HOME-01: Home page renders logo", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator(".logo-text")).toContainText("Resonate");
    });

    test("HOME-02: Mood chips are displayed", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator(".signal-chip").first()).toBeVisible();
        await expect(page.getByText("Focus")).toBeVisible();
        await expect(page.getByText("Chill")).toBeVisible();
    });

    test("HOME-03: Latest Masterings section exists", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator(".home-section-title").filter({ hasText: "Latest Masterings" })).toBeVisible();
    });

    test("HOME-04: Hero actions are visible", async ({ page }) => {
        await page.goto("/");
        // Hero stage has "View Release" and "Tracklist" buttons
        await expect(page.getByText(/View Release/i)).toBeVisible({ timeout: 15000 });
        await expect(page.getByText(/Tracklist/i)).toBeVisible();
    });

    test("HOME-05: Good Evening section exists", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByText("Good Evening")).toBeVisible();
    });

    test("HOME-06: Sidebar Upload link navigates correctly", async ({ page }) => {
        await page.goto("/");
        await page.locator(".sidebar-link").getByText("Upload").click();
        await expect(page).toHaveURL(/\/artist\/upload/);
    });

    test("HOME-07: Featured Stems section exists", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator(".home-section-title").filter({ hasText: "Featured Stems" })).toBeVisible();
    });

    test("HOME-08: Stem cards display stem type", async ({ page }) => {
        await page.goto("/");
        // Should show at least one stem card with a recognizable type label
        await expect(page.locator(".stem-card").first()).toBeVisible({ timeout: 15000 });
        await expect(page.getByText("Vocals")).toBeVisible();
    });
});
