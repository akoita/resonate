/**
 * @file player.spec.ts
 * @description E2E tests for the audio player page and controls.
 * 
 * Tests cover:
 * - Play/Prev/Next control buttons
 * - Now playing label
 * - Volume control
 * - Track info card
 * - Progress slider
 * 
 * @note Player shows default state when no track is selected
 * @requires Dev server running on localhost:3001
 */
"use strict";

import { test, expect } from "@playwright/test";

test.describe("Player Page", () => {
    test("PLAYER-01: Player page renders controls", async ({ page }) => {
        await page.goto("/player");
        // Use main role to scope to player area and avoid sidebar matches
        const main = page.getByRole("main");
        await expect(main.getByRole("button", { name: "Play" })).toBeVisible();
        await expect(main.getByRole("button", { name: "Prev" })).toBeVisible();
        await expect(main.getByRole("button", { name: "Next" })).toBeVisible();
    });

    test("PLAYER-02: Now playing label is visible", async ({ page }) => {
        await page.goto("/player");
        await expect(page.locator(".player-label")).toContainText("Now playing");
    });

    test("PLAYER-03: Volume control is present", async ({ page }) => {
        await page.goto("/player");
        await expect(page.getByText("Volume")).toBeVisible();
    });

    test("PLAYER-04: Track Info card exists", async ({ page }) => {
        await page.goto("/player");
        await expect(page.getByText("Track Info")).toBeVisible();
    });

    test("PLAYER-05: Progress slider is present", async ({ page }) => {
        await page.goto("/player");
        const sliders = page.locator("input.player-range");
        await expect(sliders).toHaveCount(2); // Progress and volume
    });
});
