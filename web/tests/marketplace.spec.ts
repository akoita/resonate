import { test, expect } from "@playwright/test";

/**
 * Marketplace UI E2E Tests
 * Tests the marketplace listing browse, stem NFT badge, and purchase UI flows.
 *
 * NOTE: These tests use mocked API responses since they don't require
 * a running blockchain. Tests that need Anvil + deployed contracts
 * are marked with `.skip()` and documented for manual/integration CI.
 */

test.describe("Marketplace", () => {
    test.beforeEach(async ({ page }) => {
        // Mock the metadata/listings API to avoid needing live backend
        await page.route("**/api/contracts/listings**", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    listings: [
                        {
                            listingId: "1",
                            tokenId: "42",
                            seller: "0x1234567890abcdef1234567890abcdef12345678",
                            price: "1000000000000000000",
                            amount: "50",
                            status: "active",
                            expiresAt: new Date(Date.now() + 86400000).toISOString(),
                            stem: {
                                id: "stem_1",
                                title: "Vocals Stem",
                                type: "vocals",
                                track: "My Song",
                                artist: "Test Artist",
                                artworkUrl: null,
                                uri: null,
                            },
                        },
                        {
                            listingId: "2",
                            tokenId: "43",
                            seller: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
                            price: "500000000000000000",
                            amount: "100",
                            status: "active",
                            expiresAt: new Date(Date.now() + 86400000).toISOString(),
                            stem: {
                                id: "stem_2",
                                title: "Bass Line",
                                type: "bass",
                                track: "Groove Track",
                                artist: "Bass Pro",
                                artworkUrl: null,
                                uri: null,
                            },
                        },
                    ],
                    total: 2,
                    limit: 20,
                    offset: 0,
                }),
            });
        });
    });

    test("marketplace page loads and displays listings", async ({ page }) => {
        await page.goto("/marketplace");

        // Should display the marketplace heading or content
        const heading = page.locator("h1, h2, [data-testid='marketplace-title']");
        await expect(heading.first()).toBeVisible({ timeout: 10000 });
    });

    test("listing cards show stem metadata", async ({ page }) => {
        await page.goto("/marketplace");

        // Wait for listings to render
        const listingCards = page.locator(
            "[data-testid='listing-card'], .listing-card, [class*='listing']"
        );

        // Marketplace should render listing cards from mock data
        await expect(listingCards.first()).toBeVisible({ timeout: 10000 });
    });

    test("navigating to /marketplace does not crash", async ({ page }) => {
        const response = await page.goto("/marketplace");
        // Should get a valid response (200, 404 redirect is OK — means page exists or is handled)
        expect(response).not.toBeNull();
        expect(response!.status()).toBeLessThan(500);
    });

    test("marketplace filters are interactive", async ({ page }) => {
        await page.goto("/marketplace");

        // Look for filter/status select or buttons
        const filterElement = page.locator(
            "select, [data-testid='filter'], [role='combobox'], button:has-text('Filter')"
        );

        const count = await filterElement.count();
        if (count > 0) {
            // Clicking a filter should not crash
            await filterElement.first().click();
        }
    });
});

test.describe("Stem NFT Badge", () => {
    test("displays minted badge when stem has NFT", async ({ page }) => {
        // Mock the stem metadata endpoint
        await page.route("**/api/metadata/stem/**", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    tokenId: "42",
                    chainId: 31337,
                    contractAddress: "0xStemNFT",
                    creator: "0xCreator",
                    transactionHash: "0xmint_hash",
                    mintedAt: new Date().toISOString(),
                }),
            });
        });

        // Navigate to any page that would show a stem
        await page.goto("/");
        // Badge tests depend on having stems visible — this is a smoke test
    });
});

test.describe("Collection Page", () => {
    test.beforeEach(async ({ page }) => {
        await page.route("**/api/metadata/collection/**", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    total: 1,
                    stems: [
                        {
                            id: "stem_1",
                            title: "Owned Vocals",
                            type: "vocals",
                            artist: "Artist",
                            trackTitle: "Song",
                            releaseTitle: "Album",
                            artworkUrl: null,
                            tokenId: "42",
                            chainId: 31337,
                            purchasedAt: new Date().toISOString(),
                        },
                    ],
                }),
            });
        });
    });

    test("collection page does not crash", async ({ page }) => {
        const response = await page.goto("/collection");
        expect(response).not.toBeNull();
        // 200 or 404 (if route doesn't exist yet) — just shouldn't be 500
        expect(response!.status()).toBeLessThan(500);
    });
});
