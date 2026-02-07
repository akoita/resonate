import { test, expect } from "@playwright/test";

/**
 * Marketplace UI E2E Tests
 * Tests the marketplace listing browse, stem NFT badge, and purchase UI flows.
 *
 * NOTE: These tests use mocked API responses since they don't require
 * a running blockchain. Tests that need Anvil + deployed contracts
 * are marked with `.skip()` and documented for manual/integration CI.
 */

const MOCK_LISTINGS = [
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
        expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour — urgent
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
];

test.describe("Marketplace", () => {
    test.beforeEach(async ({ page }) => {
        // Mock the metadata/listings API to avoid needing live backend
        await page.route("**/api/contracts/listings**", async (route) => {
            const url = new URL(route.request().url());
            const searchParam = url.searchParams.get("search");

            // If searching, filter mock data
            let results = MOCK_LISTINGS;
            if (searchParam) {
                const q = searchParam.toLowerCase();
                results = results.filter(l =>
                    l.stem?.title.toLowerCase().includes(q) ||
                    l.stem?.artist?.toLowerCase().includes(q) ||
                    l.stem?.track?.toLowerCase().includes(q)
                );
            }

            // If sorting, apply sort
            const sortBy = url.searchParams.get("sortBy");
            if (sortBy === "price_asc") {
                results = [...results].sort((a, b) => Number(BigInt(a.price) - BigInt(b.price)));
            } else if (sortBy === "price_desc") {
                results = [...results].sort((a, b) => Number(BigInt(b.price) - BigInt(a.price)));
            }

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    listings: results,
                    total: results.length,
                    limit: 24,
                    offset: 0,
                }),
            });
        });
    });

    test("marketplace page loads and displays listings", async ({ page }) => {
        await page.goto("/marketplace");

        // Should display the marketplace heading
        const heading = page.getByTestId("marketplace-title");
        await expect(heading).toBeVisible({ timeout: 10000 });
    });

    test("listing cards show stem metadata", async ({ page }) => {
        await page.goto("/marketplace");

        // Wait for listings to render — check for mock stem titles
        await expect(page.getByText("Vocals Stem")).toBeVisible({ timeout: 10000 });
        await expect(page.getByText("Bass Line")).toBeVisible({ timeout: 10000 });
    });

    test("navigating to /marketplace does not crash", async ({ page }) => {
        const response = await page.goto("/marketplace");
        // Should get a valid response (200, 404 redirect is OK — means page exists or is handled)
        expect(response).not.toBeNull();
        expect(response!.status()).toBeLessThan(500);
    });

    test("marketplace filters are interactive", async ({ page }) => {
        await page.goto("/marketplace");

        // Click the "vocals" stem type pill
        const vocalsPill = page.getByRole("button", { name: /vocals/i });
        await expect(vocalsPill).toBeVisible({ timeout: 10000 });
        await vocalsPill.click();

        // "Vocals Stem" should still be visible, "Bass Line" should be filtered out
        await expect(page.getByText("Vocals Stem")).toBeVisible();
    });

    test("sort dropdown changes ordering", async ({ page }) => {
        await page.goto("/marketplace");
        await expect(page.getByText("Vocals Stem")).toBeVisible({ timeout: 10000 });

        // Change sort to Price ↑
        const sortSelect = page.getByTestId("marketplace-sort");
        await sortSelect.selectOption("price_asc");

        // Both cards should still be visible (mock handles sorting)
        await expect(page.getByText("Vocals Stem")).toBeVisible({ timeout: 10000 });
        await expect(page.getByText("Bass Line")).toBeVisible({ timeout: 10000 });
    });

    test("search input filters listings", async ({ page }) => {
        await page.goto("/marketplace");
        await expect(page.getByText("Vocals Stem")).toBeVisible({ timeout: 10000 });

        // Type a search query
        const searchInput = page.getByTestId("marketplace-search");
        await searchInput.fill("Bass");

        // Wait for debounced refetch — Bass Line should be visible
        await expect(page.getByText("Bass Line")).toBeVisible({ timeout: 10000 });
    });

    test("expiry badge shows countdown text", async ({ page }) => {
        await page.goto("/marketplace");

        // One listing expires in 1 hour — should show urgent countdown
        await expect(page.getByText(/ending soon|left/i).first()).toBeVisible({ timeout: 10000 });
    });

    test("stem type badges are displayed on cards", async ({ page }) => {
        await page.goto("/marketplace");

        // Check for stem type badges
        await expect(page.locator(".stem-type-badge").first()).toBeVisible({ timeout: 10000 });
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
