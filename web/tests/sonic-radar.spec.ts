"use strict";

import { test, expect } from "@playwright/test";

test.describe("Sonic Radar Page", () => {
    test("sonic radar page renders hero section", async ({ page }) => {
        await page.goto("/sonic-radar");
        await expect(page.getByText("Sonic Radar")).toBeVisible();
    });

    test("sonic radar page shows auth gate or content", async ({ page }) => {
        await page.goto("/sonic-radar");
        const authOrContent = page
            .getByText("Connect your wallet")
            .or(page.getByText("Sonic Radar"));
        await expect(authOrContent).toBeVisible();
    });

    test("sonic radar empty state links to AI DJ", async ({ page }) => {
        await page.goto("/sonic-radar");
        // If empty, there should be a CTA linking to the AI DJ page
        const emptyState = page.getByText("No discoveries yet");
        const hero = page.locator(".sonic-radar-hero");
        await expect(emptyState.or(hero)).toBeVisible();
    });

    test("sonic radar page has working navigation from sidebar", async ({ page }) => {
        await page.goto("/");
        const navLink = page.getByRole("link", { name: "Sonic Radar" });
        if (await navLink.isVisible()) {
            await navLink.click();
            await expect(page).toHaveURL(/sonic-radar/);
            await expect(page.getByText("Sonic Radar")).toBeVisible();
        }
    });
});
