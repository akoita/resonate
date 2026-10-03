import { test, expect } from "./auth.setup";
import { mockSceneScoutApi } from "./fixtures/scene-scout-mock.mjs";

test("city demand card opens an editable draft with the right release", async ({ authenticatedPage: page }) => {
  await mockSceneScoutApi(page);
  let draftRequest: Record<string, unknown> | undefined;
  await page.route("**/shows/campaigns", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    draftRequest = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      json: {
        id: "scene-scout-draft",
        slug: "scene-scout-draft",
        artistId: "test-artist-id",
        sourceReleaseId: "guide-first-light",
        artistDisplayName: "Test Artist",
        title: "Test Artist in Lyon",
        city: "Lyon",
        country: "FR",
        deadline: "2026-12-01T00:00:00.000Z",
        goalAmountUnits: "10000000000",
        raisedAmountUnits: "0",
        currency: "USD",
        status: "draft",
        campaignLevel: "active_escrow_campaign",
        tiers: [],
      },
    });
  });
  await page.goto("/artist/analytics");
  await expect(page.getByRole("heading", { name: "Consider a show in Paris" })).toBeVisible();
  await page.getByRole("link", { name: "Draft a show" }).click();
  await expect(page).toHaveURL(/\/shows\/create\?city=paris&country=FR&releaseId=guide-first-light/);
  await expect(page.getByRole("status").filter({ hasText: "Listeners in Paris, FR connected with First Light" })).toBeVisible();
  await expect(page.getByLabel("City", { exact: true })).toHaveValue("Paris");
  await expect(page.getByLabel("Country", { exact: true })).toHaveValue("FR");
  await page.getByLabel("City", { exact: true }).fill("Lyon");
  await expect(page.getByLabel("City", { exact: true })).toHaveValue("Lyon");
  // The notice names what Scene Scout suggested, not whatever the artist types next.
  await expect(page.getByRole("status").filter({ hasText: "Listeners in Paris, FR connected with First Light" })).toBeVisible();
  const createDraft = page.getByRole("button", { name: "Create draft campaign" });
  await expect(createDraft).toBeEnabled();
  await createDraft.click();
  await expect.poll(() => draftRequest?.sourceReleaseId).toBe("guide-first-light");
});

test("unmet stem demand opens the owner's actual track without creating a listing", async ({ authenticatedPage: page }) => {
  await mockSceneScoutApi(page, "demand");
  const release = {
    id: "guide-first-light", artistId: "test-artist-id", title: "First Light", type: "EP", status: "ready",
    primaryArtist: "Test Artist", genre: "Afro house", moods: [], rightsRoute: "STANDARD_ESCROW",
    createdAt: "2026-10-01T09:00:00.000Z", explicit: false,
    artist: { id: "test-artist-id", displayName: "Test Artist", userId: "test-user" },
    tracks: [{ id: "guide-track", releaseId: "guide-first-light", title: "First Light",
      position: 1, processingStatus: "complete", contentStatus: "clean", explicit: false, stems: [] }],
  };
  await page.route("**/catalog/me/releases/guide-first-light", (route) => route.fulfill({ json: release }));
  await page.route("**/metadata/content-protection/release/guide-first-light", (route) => route.fulfill({ status: 404 }));
  await page.route("**/metadata/release-rights/releases/guide-first-light", (route) => route.fulfill({ json: null }));
  await page.route("**/management/releases/guide-first-light/access", (route) => route.fulfill({ status: 404 }));
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /mint|listing/.test(request.url())) writes.push(request.url());
  });
  await page.goto("/artist/analytics");
  await page.getByRole("link", { name: "Publish this stem" }).click();
  await expect(page).toHaveURL(/\/release\/guide-first-light\?demandTrack=guide-track&demandStem=vocals#scene-scout-supply/);
  await expect(page.getByRole("heading", { name: "Review vocals stem supply for First Light" })).toBeVisible();
  await expect(page.getByText("This stem is not ready to list yet.", { exact: false })).toBeVisible();
  expect(writes).toEqual([]);
});
