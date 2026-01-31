/**
 * @file upload.spec.ts
 * @description E2E tests for the artist upload flow (unauthenticated).
 * 
 * Tests cover:
 * - Auth gate behavior for unauthenticated users
 * - Page accessibility and routing
 * 
 * @note Full upload functionality requires authentication
 * @see upload.authenticated.spec.ts for authenticated tests
 * @requires Dev server running on localhost:3001
 */
"use strict";

import { test, expect } from "@playwright/test";

test.describe("Upload Flow", () => {
    test("UPLOAD-01: Auth gate shows for unauthenticated users", async ({ page }) => {
        await page.goto("/artist/upload");
        // Should show auth gate message for unauthenticated users
        await expect(page.getByText("Connect your wallet to upload releases.")).toBeVisible();
    });

    test("UPLOAD-02: Auth gate has connect button", async ({ page }) => {
        await page.goto("/artist/upload");
        // Should have a connect wallet button
        await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible();
    });

    test("UPLOAD-03: Artist upload route is accessible", async ({ page }) => {
        await page.goto("/artist/upload");
        await expect(page).toHaveURL(/\/artist\/upload/);
    });
});
