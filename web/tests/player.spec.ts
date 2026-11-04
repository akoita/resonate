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
        await expect(main.getByRole("button", { name: "Play", exact: true })).toBeVisible();
        await expect(main.getByRole("button", { name: "Prev" })).toBeVisible();
        await expect(main.getByRole("button", { name: "Next" })).toBeVisible();
    });

    test("PLAYER-02: System monitoring label is visible", async ({ page }) => {
        await page.goto("/player");
        await expect(page.getByText("System Monitoring")).toBeVisible();
    });

    test("PLAYER-03: Output Gain label is present", async ({ page }) => {
        await page.goto("/player");
        await expect(page.getByText("Output Gain")).toBeVisible();
    });

    test("PLAYER-04: Track Title is present", async ({ page }) => {
        await page.goto("/player");
        // Default text when no track is selected
        await expect(page.getByText("No track selected")).toBeVisible();
    });

    test("PLAYER-05: Progress slider is present", async ({ page }) => {
        await page.goto("/player");
        const sliders = page.locator("input.player-range");
        await expect(sliders).toHaveCount(2); // Progress and volume
    });
});

// #2569: the console docks, floats, moves and minimizes, remembered per device.
test.describe("Player console layout", () => {
    test("PLAYER-06: docks left, minimizes, and remembers it after reload", async ({ page }) => {
        await page.goto("/player");
        const panel = page.getByRole("complementary", { name: "Player console" });
        await expect(panel).toBeVisible();

        await panel.getByRole("button", { name: "Console layout" }).click();
        await page.getByRole("menuitem", { name: "Dock left" }).click();
        const stage = page.locator(".player-master-stage");
        await expect(stage).toHaveAttribute("data-console-dock", "left");
        const box = await panel.boundingBox();
        const viewport = page.viewportSize();
        expect(box && viewport && box.x + box.width / 2 < viewport.width / 2).toBe(true);

        await panel.getByRole("button", { name: "Minimize player console" }).click();
        await expect(page.getByText("Output Gain")).toBeHidden();

        await page.reload();
        await expect(stage).toHaveAttribute("data-console-dock", "left");
        await expect(panel.getByRole("button", { name: "Restore player console" })).toBeVisible();
        await panel.getByRole("button", { name: "Restore player console" }).click();
        await expect(page.getByText("Output Gain")).toBeVisible();
    });

    test("PLAYER-07: dragging the header undocks the console and moves it", async ({ page }) => {
        await page.goto("/player");
        const panel = page.getByRole("complementary", { name: "Player console" });
        const handle = panel.getByRole("button", { name: /Move player console/ });
        const start = await handle.boundingBox();
        if (!start) throw new Error("move handle not laid out");
        await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
        await page.mouse.down();
        await page.mouse.move(start.x - 200, start.y + 60, { steps: 8 });
        await page.mouse.move(start.x - 300, start.y + 80, { steps: 4 });
        await page.mouse.up();
        await expect(page.locator(".player-master-stage")).toHaveAttribute("data-console-dock", "floating");
        const moved = await handle.boundingBox();
        expect(moved && moved.x < start.x - 200).toBe(true);

        // Arrow keys move a floating console; reset returns it to the right dock.
        await handle.focus();
        const before = await panel.boundingBox();
        await page.keyboard.press("ArrowDown");
        await expect.poll(async () => (await panel.boundingBox())?.y).toBeGreaterThan(before?.y ?? 0);
        await panel.getByRole("button", { name: "Console layout" }).click();
        await page.getByRole("menuitem", { name: "Reset layout" }).click();
        await expect(page.locator(".player-master-stage")).toHaveAttribute("data-console-dock", "right");
    });
});
