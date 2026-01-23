/**
 * @file auth.setup.ts
 * @description Playwright fixtures for authenticated E2E tests.
 * 
 * Provides utilities to inject mock authentication state into localStorage
 * before page load, allowing tests to bypass the AuthGate and access
 * protected features like the upload form.
 * 
 * @example
 * ```typescript
 * import { test } from "./auth.setup";
 * 
 * test("authenticated test", async ({ authenticatedPage }) => {
 *   await authenticatedPage.goto("/artist/upload");
 *   // Page is now authenticated
 * });
 * ```
 */

import { test as base, Page } from "@playwright/test";

// Mock credentials for test user
export const MOCK_AUTH = {
    // Valid-looking Ethereum address
    address: "0x742d35cc6634c0532925a3b844bc9e7595f1ea2c",
    // Mock JWT token (not cryptographically valid, but passes UI checks)
    // Payload: { sub: "test-user", role: "artist" }
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJyb2xlIjoiYXJ0aXN0IiwiYWRkcmVzcyI6IjB4NzQyZDM1Y2M2NjM0YzA1MzI5MjVhM2I4NDRiYzllNzU5NWYxZWEyYyIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxODAwMDAwMDAwfQ.mock-signature",
};

/**
 * Injects mock authentication into localStorage before page navigation.
 * This allows the AuthProvider to read the credentials on mount and
 * set status to "authenticated".
 */
export async function injectMockAuth(page: Page): Promise<void> {
    await page.addInitScript((auth) => {
        localStorage.setItem("resonate.token", auth.token);
        localStorage.setItem("resonate.address", auth.address);
    }, MOCK_AUTH);
}

/**
 * Creates a page with mock authentication already injected.
 * Use this when you need authenticated access to protected routes.
 */
export async function createAuthenticatedPage(page: Page): Promise<Page> {
    await injectMockAuth(page);
    return page;
}

// Extended test fixture with authenticated page
type AuthFixtures = {
    authenticatedPage: Page;
};

/**
 * Extended Playwright test with authenticated page fixture.
 * 
 * @example
 * ```typescript
 * import { test, expect } from "./auth.setup";
 * 
 * test("can access upload page", async ({ authenticatedPage }) => {
 *   await authenticatedPage.goto("/artist/upload");
 *   await expect(authenticatedPage.getByText("Upload your track")).toBeVisible();
 * });
 * ```
 */
export const test = base.extend<AuthFixtures>({
    authenticatedPage: async ({ page }, use) => {
        await injectMockAuth(page);
        // eslint-disable-next-line react-hooks/rules-of-hooks
        await use(page);
    },
});

export { expect } from "@playwright/test";
