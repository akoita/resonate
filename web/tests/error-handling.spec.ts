/**
 * @file error-handling.spec.ts
 * @description E2E tests for error handling and form validation.
 * 
 * Tests cover:
 * - Upload form access when authenticated
 * - Form structure and fields
 * - Button states
 * 
 * @requires Dev server running on localhost:3001
 */
"use strict";

import { test, expect } from "./auth.setup";

test.describe("Error Handling & Form Validation", () => {
    test("ERR-01: Upload page shows form when authenticated", async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/artist/upload");

        // Should NOT show auth gate
        await expect(authenticatedPage.getByText("Connect your wallet to continue")).not.toBeVisible();

        // Should show upload form
        await expect(authenticatedPage.getByText("Upload your track")).toBeVisible();
    });

    test("ERR-02: Publish button exists in form", async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/artist/upload");
        await authenticatedPage.waitForLoadState("networkidle");

        // Publish button should exist
        const publishBtn = authenticatedPage.getByRole("button", { name: /Publish release/i });
        await expect(publishBtn).toBeVisible();
    });

    test("ERR-03: Form has required input fields", async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/artist/upload");
        await authenticatedPage.waitForLoadState("networkidle");

        // Check that multiple input fields exist
        const inputs = authenticatedPage.locator(".ui-input");
        const count = await inputs.count();
        expect(count).toBeGreaterThan(3);
    });

    test("ERR-04: File drop zone has instructions", async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/artist/upload");
        await authenticatedPage.waitForLoadState("networkidle");

        // Drop zone should show supported formats
        await expect(authenticatedPage.getByText(/Supports MP3, WAV, FLAC, AIFF/i)).toBeVisible();
    });
});
