/**
 * @file player.authenticated.spec.ts
 * @description E2E tests for the player page with authentication.
 * 
 * Tests player functionality when user is authenticated, including:
 * - Track info display
 * - Social share panel (requires track)
 * - Player interactions
 * 
 * @note Some tests require a track to be loaded via trackId param
 * @requires Dev server running on localhost:3001
 */
"use strict";

import { test, expect } from "./auth.setup";

test.describe("Authenticated Player", () => {
    test("PLAYER-AUTH-01: Player accessible when authenticated", async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/player");

        // Player controls should be visible
        const main = authenticatedPage.getByRole("main");
        await expect(main.getByRole("button", { name: "Play" })).toBeVisible();
    });

    test("PLAYER-AUTH-02: Track info card visible", async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/player");

        // Track info card should be visible
        await expect(authenticatedPage.getByText("Track Info")).toBeVisible();
    });

    test("PLAYER-AUTH-03: Player with mock trackId shows track info card", async ({ authenticatedPage }) => {
        // Navigate with a trackId parameter
        await authenticatedPage.goto("/player?trackId=test-track-123");

        // Track info card should be present
        await expect(authenticatedPage.getByText("Track Info")).toBeVisible();
    });

    test("PLAYER-AUTH-04: Volume slider is interactive", async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/player");

        // Volume slider should be present
        const volumeSlider = authenticatedPage.locator("input.player-range").last();
        await expect(volumeSlider).toBeVisible();

        // Should have min/max attributes
        await expect(volumeSlider).toHaveAttribute("min", "0");
        await expect(volumeSlider).toHaveAttribute("max", "100");
    });

    test("PLAYER-AUTH-05: Now playing label visible", async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/player");

        // Now playing label should be visible
        await expect(authenticatedPage.locator(".player-label")).toContainText("Now playing");
    });
});
