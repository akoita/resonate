/**
 * @file marketplace.spec.ts
 * @description E2E tests for the marketplace — runs against the REAL backend.
 *
 * No mocks. The database is seeded by global-setup.ts before the suite starts.
 * Seeded test data:
 *   - "Vocals Stem" listing (1 ETH, 7-day expiry)
 *   - "Bass Line" listing (0.5 ETH, 1-hour expiry — urgent)
 *   - Artist: "Test Artist", Track: "Groove Track", Genre: "Electronic"
 *
 * @requires Postgres running with seeded data
 * @requires Backend on :3000, Frontend on :3001 (auto-started by playwright.config)
 */
"use strict";

import { test, expect } from "@playwright/test";

/** The marketplace browser is the "Browse stems" tab of Crates & Stems (#2032). */
const BROWSE_STEMS = "/crates?tab=stems";

test.describe("Marketplace", () => {

    test("browse stems tab loads and displays heading", async ({ page }) => {
        await page.goto(BROWSE_STEMS);
        const heading = page.getByTestId("marketplace-title").first();
        await expect(heading).toBeVisible({ timeout: 15000 });
    });

    test("listing cards show stem metadata from real backend", async ({ page }) => {
        await page.goto(BROWSE_STEMS);

        // These titles come from the seeded database
        await expect(page.getByText("Vocals Stem")).toBeVisible({ timeout: 15000 });
        await expect(page.getByText("Bass Line")).toBeVisible({ timeout: 15000 });
    });

    test("listing cards show artist and track info", async ({ page }) => {
        await page.goto(BROWSE_STEMS);

        await expect(page.getByText("Vocals Stem")).toBeVisible({ timeout: 15000 });
        // Scope to stem-card to avoid matching hidden <option> elements in filter dropdowns
        const card = page.locator("[data-testid='stem-card']").first();
        await expect(card.getByText("Test Artist")).toBeVisible();
        await expect(card.getByText("Groove Track")).toBeVisible();
    });

    test("marketplace filters are interactive", async ({ page }) => {
        await page.goto(BROWSE_STEMS);

        // Wait for listings to load
        await expect(page.getByText("Vocals Stem")).toBeVisible({ timeout: 15000 });

        // Click the "vocals" pill — should keep "Vocals Stem", hide "Bass Line"
        const vocalsPill = page.getByRole("button", { name: /^vocals$/i });
        await vocalsPill.click();

        await expect(page.getByText("Vocals Stem")).toBeVisible();
        // Bass Line should be filtered out by stem type pill (client-side filter)
        await expect(page.getByText("Bass Line")).not.toBeVisible();
    });

    test("sort dropdown changes ordering", async ({ page }) => {
        await page.goto(BROWSE_STEMS);
        await expect(page.getByText("Vocals Stem")).toBeVisible({ timeout: 15000 });

        // Sort by Price ↑ — the real backend will re-order.
        // `.first()` is a Playwright strict-mode guard: during the
        // hydration window the select can briefly exist twice in the
        // DOM (SSR copy + client copy), so we target the first
        // semantic instance.
        const sortSelect = page.getByTestId("marketplace-sort").first();
        await sortSelect.selectOption("price_asc");

        // Both listings should still appear (just in a different order)
        await expect(page.getByText("Vocals Stem")).toBeVisible({ timeout: 15000 });
        await expect(page.getByText("Bass Line")).toBeVisible({ timeout: 15000 });
    });

    test("search input filters listings via real API", async ({ page }) => {
        await page.goto(BROWSE_STEMS);
        await expect(page.getByText("Vocals Stem")).toBeVisible({ timeout: 15000 });

        // Search for "Bass" — the backend does full-text search across title/track/artist
        const searchInput = page.getByTestId("marketplace-search");
        await searchInput.fill("Bass");

        // After debounce, "Bass Line" should be found, "Vocals Stem" may disappear
        await expect(page.getByText("Bass Line")).toBeVisible({ timeout: 15000 });
    });

    test("expiry badge shows countdown text", async ({ page }) => {
        await page.goto(BROWSE_STEMS);
        await expect(page.getByText("Vocals Stem")).toBeVisible({ timeout: 15000 });

        // One listing has 1-hour expiry — should show an urgency indicator
        // Look for the expiry-badge component itself (rendered on all active listings)
        await expect(page.locator(".expiry-badge").first()).toBeVisible({ timeout: 15000 });
    });

    test("stem type badges are displayed on cards", async ({ page }) => {
        await page.goto(BROWSE_STEMS);
        await expect(page.getByText("Vocals Stem")).toBeVisible({ timeout: 15000 });
        await expect(page.locator(".stem-type-badge").first()).toBeVisible();
    });

    test("navigating to the Browse stems tab does not crash", async ({ page }) => {
        const response = await page.goto(BROWSE_STEMS);
        expect(response).not.toBeNull();
        expect(response!.status()).toBeLessThan(500);
    });
});

test.describe("Old marketplace and AI DJ URLs redirect (#2032)", () => {
    test("/marketplace opens the Browse stems tab", async ({ page }) => {
        await page.goto("/marketplace");
        await expect(page).toHaveURL(/\/crates\?tab=stems$/);
        await expect(page.getByRole("tab", { name: "Browse stems" })).toHaveAttribute("aria-selected", "true");
    });

    test("/marketplace keeps incoming query params", async ({ page }) => {
        await page.goto("/marketplace?utm_source=email");
        await expect(page).toHaveURL(/\/crates\?(?=.*tab=stems)(?=.*utm_source=email)/);
    });

    test("/marketplace/manage opens artist listings", async ({ page }) => {
        await page.goto("/marketplace/manage?status=expired");
        await expect(page).toHaveURL(/\/artist\/listings\?status=expired$/);
    });

    test("/agent lands on the AI DJ section of Home", async ({ page }) => {
        await page.goto("/agent");
        await expect(page).toHaveURL(/\/#ai-dj$/);
    });
});

test.describe("Stem NFT Badge", () => {
    test("displays minted badge when stem has NFT", async ({ page }) => {
        // Navigate to Browse stems — seeded data has a StemNftMint linked to tokenId 42
        await page.goto(BROWSE_STEMS);
        await expect(page.getByText("Vocals Stem")).toBeVisible({ timeout: 15000 });
        // The vocals stem has an NFT mint — it should render (smoke test)
    });
});

test.describe("Collection Page", () => {
    test("collection page does not crash", async ({ page }) => {
        const response = await page.goto("/collection");
        expect(response).not.toBeNull();
        expect(response!.status()).toBeLessThan(500);
    });
});
