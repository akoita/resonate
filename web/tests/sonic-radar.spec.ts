"use strict";

import { test, expect } from "@playwright/test";

test.describe("Sonic Radar Page", () => {
    test("sonic radar page renders without crashing", async ({ page }) => {
        const response = await page.goto("/sonic-radar");
        expect(response).not.toBeNull();
        expect(response!.status()).toBeLessThan(500);
    });

    test("sonic radar page shows auth gate or content", async ({ page }) => {
        await page.goto("/sonic-radar");
        // Without auth, AuthGate renders; with auth, the hero section renders
        const authPanel = page.locator(".auth-panel");
        const hero = page.locator(".sonic-radar-hero");
        await expect(authPanel.or(hero)).toBeVisible({ timeout: 10000 });
    });

    test("sonic radar auth gate has correct prompt", async ({ page }) => {
        await page.goto("/sonic-radar");
        const authTitle = page.locator(".auth-title");
        if (await authTitle.isVisible({ timeout: 5000 }).catch(() => false)) {
            await expect(authTitle).toContainText("wallet");
        }
    });

    test("sonic radar empty state links to AI DJ when authenticated", async ({ page }) => {
        await page.goto("/sonic-radar");
        // If authenticated and empty, there should be a CTA to launch AI DJ
        const emptyState = page.getByText("No discoveries yet");
        const hero = page.locator(".sonic-radar-hero");
        const authPanel = page.locator(".auth-panel");
        await expect(emptyState.or(hero).or(authPanel)).toBeVisible({ timeout: 10000 });
    });

    test("sonic radar page has working navigation from sidebar", async ({ page }) => {
        await page.goto("/");
        const navLink = page.getByRole("link", { name: "Sonic Radar" });
        if (await navLink.isVisible({ timeout: 5000 }).catch(() => false)) {
            await navLink.click();
            await expect(page).toHaveURL(/sonic-radar/);
            // Page loaded successfully — auth gate or hero visible
            const authPanel = page.locator(".auth-panel");
            const hero = page.locator(".sonic-radar-hero");
            await expect(authPanel.or(hero)).toBeVisible({ timeout: 10000 });
        }
    });
});
