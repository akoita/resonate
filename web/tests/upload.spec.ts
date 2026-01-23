"use strict";

import { test, expect } from "@playwright/test";

test.describe("Upload Flow", () => {
    test("UPLOAD-01: Upload page shows auth gate when not connected", async ({ page }) => {
        await page.goto("/artist/upload");
        // When not authenticated, the auth gate should be visible
        await expect(page.getByText("Connect your wallet")).toBeVisible();
    });

    test("UPLOAD-02: Upload page has correct title", async ({ page }) => {
        await page.goto("/artist/upload");
        await expect(page.getByText("Connect your wallet to upload releases")).toBeVisible();
    });

    test("UPLOAD-03: Artist upload route is accessible", async ({ page }) => {
        await page.goto("/artist/upload");
        await expect(page).toHaveURL(/\/artist\/upload/);
    });
});
