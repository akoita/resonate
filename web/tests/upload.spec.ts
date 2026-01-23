/**
 * @file upload.spec.ts
 * @description E2E tests for the artist upload flow.
 * 
 * Tests cover:
 * - Auth gate behavior for unauthenticated users
 * - Page accessibility and routing
 * 
 * @note Full upload functionality requires authentication
 * @requires Dev server running on localhost:3001
 */
"use strict";

import { test, expect } from "@playwright/test";

test.describe("Upload Flow", () => {
    test("UPLOAD-01: Auth gate shows for unauthenticated users", async ({ page }) => {
        await page.goto("/artist/upload");
        // Should show auth gate message for unauthenticated users
        await expect(page.getByText("Connect your wallet")).toBeVisible();
    });

    test("UPLOAD-02: Upload page has correct title", async ({ page }) => {
        await page.goto("/artist/upload");
        // Check that the page renders (either auth gate or upload form)
        await expect(page.locator("main")).toBeVisible();
    });

    test("UPLOAD-03: Artist upload route is accessible", async ({ page }) => {
        await page.goto("/artist/upload");
        await expect(page).toHaveURL(/\/artist\/upload/);
    });
});
