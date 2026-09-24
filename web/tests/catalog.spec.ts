/**
 * @file catalog.spec.ts
 * @description E2E tests for the home page and catalog — runs against the REAL backend.
 *
 * No mocks. The database is seeded by global-setup.ts before the suite starts.
 * Seeded test data includes a published release with track and stems.
 *
 * The home page uses the "Home v3" shelf system. Sections are: Hero, Tuner
 * (genre/mood filter + vibe session), personalized feed shelves, Trending Now,
 * Top Artists, Stem Lab, Upcoming Live Events, Drops, Recently Added (catalog
 * browser), AI DJ presets, and Your studio (Managed Catalog + Your Releases).
 * The old "Resume Playing" row and cosmetic "Trending Stems" cards no longer
 * exist — the assertions below map onto the current sections instead.
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

    test("HOME-03: Tuner exposes the genre and mood filter group", async ({ page }) => {
        await page.goto("/");
        // `.first()` guards against StrictMode-in-dev / hydration-window
        // double-render before the pre-hydrate copy is replaced.
        const filters = page.getByRole("group", { name: "Filter trending" }).first();
        await expect(filters).toBeVisible();
        await expect(filters.getByRole("button", { name: "All Trending" })).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByRole("link", { name: "Open AI DJ" }).first()).toHaveAttribute("href", "/agent");
    });

    test("HOME-04: Hero actions are visible", async ({ page }) => {
        await page.goto("/");
        // Campaign hero exposes "Back This Show" (campaign detail) + "All Campaigns" (list).
        // Scoped to the hero: the live-event ticket cards also read "Back this show".
        const hero = page.locator(".ng-hero").first();
        await expect(hero.getByRole("link", { name: /Back This Show/i })).toBeVisible({ timeout: 15000 });
        await expect(hero.getByRole("link", { name: /All Campaigns/i })).toBeVisible();
    });

    test("HOME-05: Upcoming Live Events section exists", async ({ page }) => {
        await page.goto("/");
        await expect(
            page.getByRole("heading", { name: "Upcoming Live Events" }).first(),
        ).toBeVisible();
    });

    test("HOME-06: Sidebar Upload link navigates correctly", async ({ page }) => {
        await page.goto("/");
        await page.locator(".sidebar-link").getByText("Upload").click();
        await expect(page).toHaveURL(/\/artist\/upload/);
    });

    test("HOME-07: Stem Lab section exists", async ({ page }) => {
        await page.goto("/");
        await expect(
            page.getByRole("heading", { name: "Stem Lab" }).first(),
        ).toBeVisible({ timeout: 15000 });
    });

    test("HOME-08: Stem Lab channels solo real stems in the mixer", async ({ page }) => {
        await page.goto("/");
        // Seeded releases carry real vocals + drums stems; each channel links
        // to the release mixer with that stem soloed.
        const channel = page
            .locator(".ng-stemlab-channel")
            .filter({ hasText: /Vocals|Drums|Bass|Piano|Guitar|Other/ })
            .first();
        await expect(channel).toBeVisible({ timeout: 15000 });
        await expect(channel).toHaveAttribute("href", /\/release\/[^?]+\?mixer=true&stem=(vocals|drums|bass|piano|guitar|other)$/);
    });

    test("HOME-09: Global catalog snapshot exposes releases, artists, stems, and recent catalog navigation", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("heading", { name: "Recently Added" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "releases" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "artists" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "stems" })).toBeVisible();
        await expect(page.getByLabel("Search catalog snapshot")).toBeVisible();
        // Scoped to the snapshot footer: the Stem Lab shelf also links to /catalog.
        await expect(
            page.locator(".ng-catalog-footer").getByRole("link", { name: /Browse catalog/i }),
        ).toHaveAttribute("href", "/catalog");
    });

    test("CATALOG-01: Recent catalog page exposes the larger recent browse window", async ({ page }) => {
        await page.goto("/catalog");
        await expect(page.getByRole("heading", { name: "Browse recent catalog" })).toBeVisible();
        await expect(page.getByText("Search the latest 200 public releases")).toBeVisible();
        await expect(page.getByLabel("Search recent catalog")).toBeVisible();
        await expect(page.getByRole("tab", { name: /releases/i })).toBeVisible();
        await expect(page.getByRole("tab", { name: /artists/i })).toBeVisible();
        await expect(page.getByRole("tab", { name: /stems/i })).toBeVisible();
    });

    test("HOME-09b: Release cards expose library and playlist actions", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator(".ng-cat-card").first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator(".ng-cat-card__action[aria-label^='Add']").first()).toBeVisible();
        await expect(page.locator(".ng-cat-card__action[aria-label^='Save']").first()).toBeVisible();
    });

    test("HOME-10: Managed catalog panel is separate from Library", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("heading", { name: "Managed Catalog" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Your Releases" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Open managed catalog" })).toHaveAttribute("href", "/artist/catalog");
        await expect(page.getByRole("link", { name: "Open full release inventory" })).toHaveAttribute("href", "/artist/catalog");
    });
});
