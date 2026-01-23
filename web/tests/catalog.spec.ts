/**
 * @file catalog.spec.ts
 * @description E2E tests for the home page and catalog functionality.
 * 
 * Tests cover:
 * - Hero section rendering
 * - Mood chip display
 * - New Releases section
 * - AI Curated section
 * - Navigation to upload page
 * 
 * @requires Dev server running on localhost:3001
 */
"use strict";

import { test, expect } from "@playwright/test";

test.describe("Catalog & Home Page", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/");
    });

    test("HOME-01: Home hero section renders title", async ({ page }) => {
        await expect(page.locator(".home-title")).toContainText("Resonate");
    });

    test("HOME-02: Mood chips are displayed", async ({ page }) => {
        await expect(page.locator(".home-chip").first()).toBeVisible();
        await expect(page.getByText("Focus")).toBeVisible();
        await expect(page.getByText("Chill")).toBeVisible();
    });

    test("HOME-03: New Releases section exists", async ({ page }) => {
        await expect(page.locator(".home-section-title").first()).toContainText("New Releases");
    });

    test("HOME-04: Start session and Upload buttons visible", async ({ page }) => {
        await expect(page.getByText("Start session")).toBeVisible();
        await expect(page.getByText("Upload stems")).toBeVisible();
    });

    test("HOME-05: AI Curated section exists", async ({ page }) => {
        await expect(page.getByText("AI Curated")).toBeVisible();
    });

    test("HOME-06: Clicking Upload stems navigates correctly", async ({ page }) => {
        // Find the Upload stems button in the main content area
        await page.locator(".home-actions").getByText("Upload stems").click();
        await expect(page).toHaveURL(/\/artist\/upload/);
    });
});
