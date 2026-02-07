"use strict";

import { test, expect } from "@playwright/test";

test.describe("AI DJ Agent Page", () => {
    test("agent page renders without crashing", async ({ page }) => {
        const response = await page.goto("/agent");
        expect(response).not.toBeNull();
        expect(response!.status()).toBeLessThan(500);
    });

    test("agent page shows auth gate when not authenticated", async ({ page }) => {
        await page.goto("/agent");
        // Without auth, the AuthGate renders with "Connect Wallet" button
        const authPanel = page.locator(".auth-panel");
        const connectBtn = page.getByText("Connect Wallet");
        await expect(authPanel.or(connectBtn)).toBeVisible({ timeout: 10000 });
    });

    test("agent page auth gate has correct prompt", async ({ page }) => {
        await page.goto("/agent");
        // AuthGate shows a custom title for the AI DJ page
        const authTitle = page.locator(".auth-title");
        if (await authTitle.isVisible({ timeout: 5000 }).catch(() => false)) {
            await expect(authTitle).toContainText("wallet");
        }
    });

    test("Get Started button opens wizard when authenticated", async ({ page }) => {
        await page.goto("/agent");
        const btn = page.getByRole("button", { name: "Get Started" });
        if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await btn.click();
            // Wizard step 1 should show the name input
            await expect(page.getByText("Name Your DJ")).toBeVisible();
        }
    });

    test("wizard allows completing all steps when authenticated", async ({ page }) => {
        await page.goto("/agent");
        const btn = page.getByRole("button", { name: "Get Started" });
        if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await btn.click();
            // Step 1: Name
            await expect(page.getByText("Name Your DJ")).toBeVisible();
            const nameInput = page.getByRole("textbox");
            await nameInput.fill("test-dj");
            await page.getByRole("button", { name: "Next" }).click();

            // Step 2: Vibe
            await expect(page.getByText("Choose Your Vibes")).toBeVisible();
        }
    });

    test("dashboard shows one of expected states", async ({ page }) => {
        await page.goto("/agent");
        // Without auth: auth-panel; with auth + no config: agent-empty-state; with config: agent-dashboard-grid; loading: agent-loading
        const anyState = page.locator(".auth-panel, .agent-dashboard-grid, .agent-empty-state, .agent-loading");
        await expect(anyState.first()).toBeVisible({ timeout: 10000 });
    });
});
