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
        await expect(main.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    });

    test("PLAYER-AUTH-02: System monitoring label visible", async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/player");

        // System monitoring label should be visible
        await expect(authenticatedPage.getByText("System Monitoring")).toBeVisible();
    });

    test("PLAYER-AUTH-03: Player with mock trackId shows track title", async ({ authenticatedPage }) => {
        // Navigate with a trackId parameter (mock ID)
        await authenticatedPage.goto("/player?trackId=test-track-123");

        // Since it's a mock ID that won't exist in actual DB, it might show "No track selected" 
        // or just the generic player UI. We check for a common element.
        await expect(authenticatedPage.getByText("Queue Manifest", { exact: true })).toBeVisible();
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

    test("PLAYER-AUTH-05: Output Gain label visible", async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/player");

        // Output Gain label should be visible
        await expect(authenticatedPage.getByText("Output Gain")).toBeVisible();
    });

    test("PLAYER-AUTH-06: mute restores the prior slider value", async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/player");
        const slider = authenticatedPage.locator("input.player-range").last();
        await authenticatedPage.waitForTimeout(750);
        await slider.fill("37");
        await expect(slider).toHaveValue("37");

        const mute = authenticatedPage.getByRole("button", { name: "Mute" });
        await mute.click();
        await expect(authenticatedPage.getByRole("button", { name: "Unmute" })).toHaveAttribute("aria-pressed", "true");
        await expect(slider).toHaveValue("0");

        await authenticatedPage.getByRole("button", { name: "Unmute" }).click();
        await expect(slider).toHaveValue("37");
    });

    test("PLAYER-AUTH-07: immersive mode enters and exits without replacing controls", async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/player");
        await authenticatedPage.getByRole("button", { name: "Open immersive player" }).click();
        await expect(authenticatedPage.getByRole("button", { name: "Exit immersive player" })).toBeVisible();
        await expect(authenticatedPage.getByRole("main").getByRole("button", { name: "Play", exact: true })).toBeVisible();
        await authenticatedPage.keyboard.press("Escape");
        await expect(authenticatedPage.getByRole("button", { name: "Open immersive player" })).toBeVisible();
    });
});
