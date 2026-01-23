/**
 * @file upload.authenticated.spec.ts
 * @description E2E tests for the artist upload flow with authentication.
 * 
 * These tests use mock authentication to bypass the AuthGate and test:
 * - Upload form rendering and interactions
 * - File selection and validation
 * - Form fields
 * 
 * @requires Dev server running on localhost:3001
 */
"use strict";

import { test, expect } from "./auth.setup";

test.describe("Authenticated Upload Flow", () => {
    test.beforeEach(async ({ authenticatedPage }) => {
        await authenticatedPage.goto("/artist/upload");
        // Wait for page to be fully loaded
        await authenticatedPage.waitForLoadState("networkidle");
    });

    test("UPLOAD-02: Upload page shows upload form when authenticated", async ({ authenticatedPage }) => {
        // Should see the upload form, not the auth gate
        await expect(authenticatedPage.getByText("Upload your track")).toBeVisible();
    });

    test("UPLOAD-03: File drop zone is visible", async ({ authenticatedPage }) => {
        // Drop zone should be visible with correct class
        const dropZone = authenticatedPage.locator(".file-drop-zone");
        await expect(dropZone).toBeVisible();

        // Should have appropriate text
        await expect(authenticatedPage.getByText(/Drop audio file/i)).toBeVisible();
    });

    test("UPLOAD-04: File input accepts audio files", async ({ authenticatedPage }) => {
        // Check that file input exists
        const fileInput = authenticatedPage.locator("input[type='file']");
        await expect(fileInput).toHaveCount(1);

        // Verify accept attribute includes audio
        const acceptAttr = await fileInput.getAttribute("accept");
        expect(acceptAttr).toContain("audio");
    });

    test("UPLOAD-05: Form input fields are present", async ({ authenticatedPage }) => {
        // Check form inputs exist (Input component renders as ui-input class)
        const inputs = authenticatedPage.locator(".ui-input");
        const inputCount = await inputs.count();
        expect(inputCount).toBeGreaterThan(0);
    });

    test("UPLOAD-06: Publish button is present", async ({ authenticatedPage }) => {
        // Publish button should be visible
        const publishBtn = authenticatedPage.getByRole("button", { name: /Publish release/i });
        await expect(publishBtn).toBeVisible();
    });

    test("UPLOAD-07: Supported formats text is displayed", async ({ authenticatedPage }) => {
        // Check for supported formats text
        await expect(authenticatedPage.getByText(/Supports MP3, WAV, FLAC, AIFF/i)).toBeVisible();
    });

    test("UPLOAD-08: Release settings section exists", async ({ authenticatedPage }) => {
        // Check for release settings section (actual title used in the page)
        await expect(authenticatedPage.getByText("Release settings")).toBeVisible();
    });
});
