/**
 * @file catalog.spec.ts
 * @description E2E tests for the home page and catalog — runs against the REAL backend.
 *
 * No mocks. The database is seeded by global-setup.ts before the suite starts.
 * Seeded test data includes a published release with track and stems.
 *
 * The home page was rebuilt on the Stitch "Next-Gen Music Platform" design in
 * #646. Sections are now: Hero, Filter Chips, Resume Playing, Trending Stems,
 * Upcoming Live Events, Agentic Mixes, Top Artists. Old "Latest Masterings /
 * Good Evening / Featured Stems" rows no longer exist — the assertions below
 * map onto the new rows instead.
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

    test("HOME-03: Resume Playing section exists", async ({ page }) => {
        await page.goto("/");
        await expect(
            page.locator(".ng-section-title").filter({ hasText: "Resume Playing" }),
        ).toBeVisible();
    });

    test("HOME-04: Hero actions are visible", async ({ page }) => {
        await page.goto("/");
        // New hero (Stitch design) exposes "Listen Now" + "View Campaign".
        await expect(page.getByRole("link", { name: /Listen Now/i })).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole("link", { name: /View Campaign/i })).toBeVisible();
    });

    test("HOME-05: Upcoming Live Events section exists", async ({ page }) => {
        await page.goto("/");
        await expect(
            page.locator(".ng-section-title").filter({ hasText: "Upcoming Live Events" }),
        ).toBeVisible();
    });

    test("HOME-06: Sidebar Upload link navigates correctly", async ({ page }) => {
        await page.goto("/");
        await page.locator(".sidebar-link").getByText("Upload").click();
        await expect(page).toHaveURL(/\/artist\/upload/);
    });

    test("HOME-07: Trending Stems section exists", async ({ page }) => {
        await page.goto("/");
        await expect(
            page.locator(".ng-section-title").filter({ hasText: "Trending Stems" }),
        ).toBeVisible();
    });

    test("HOME-08: Stem cards display a type tag", async ({ page }) => {
        await page.goto("/");
        const firstStemCard = page.locator(".ng-stem-card").first();
        await expect(firstStemCard).toBeVisible({ timeout: 15000 });
        // Stem cards rotate through Drums / Vocals / Synth tags; at least
        // one should be present on the page.
        await expect(
            page.locator(".ng-stem-card__tag").filter({ hasText: /Drums|Vocals|Synth/i }).first(),
        ).toBeVisible();
    });
});
