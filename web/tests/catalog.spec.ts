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
        // Mock the releases API to ensure data is available for the Hero section
        await page.route("*/**/catalog/published*", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify([
                    {
                        id: "test-release-id",
                        title: "Test Release",
                        primaryArtist: "Test Artist",
                        type: "Single",
                        releaseDate: "2026-01-01",
                        label: "Test Label",
                        artworkUrl: "https://placehold.co/600x600.png",
                        artist: { id: "artist-id", displayName: "Test Artist" },
                        tracks: [{ id: "t1", title: "Test Track", durationSeconds: 180 }]
                    }
                ]),
            });
        });

        await page.goto("/");
    });

    test("HOME-01: Home page renders logo", async ({ page }) => {
        await expect(page.locator(".logo-text")).toContainText("Resonate");
    });

    test("HOME-02: Mood chips are displayed", async ({ page }) => {
        await expect(page.locator(".signal-chip").first()).toBeVisible();
        await expect(page.getByText("Focus")).toBeVisible();
        await expect(page.getByText("Chill")).toBeVisible();
    });

    test("HOME-03: Latest Masterings section exists", async ({ page }) => {
        await expect(page.locator(".home-section-title").nth(1)).toContainText("Latest Masterings");
    });

    test("HOME-04: Hero actions are visible", async ({ page }) => {
        // Hero stage has "View Release" and "Tracklist" buttons
        await expect(page.getByText(/View Release/i)).toBeVisible();
        await expect(page.getByText(/Tracklist/i)).toBeVisible();
    });

    test("HOME-05: Good Evening section exists", async ({ page }) => {
        await expect(page.getByText("Good Evening")).toBeVisible();
    });

    test("HOME-06: Sidebar Upload link navigates correctly", async ({ page }) => {
        // Use the sidebar link instead of a non-existent button on home page
        await page.locator(".sidebar-link").getByText("Upload").click();
        await expect(page).toHaveURL(/\/artist\/upload/);
    });
});
