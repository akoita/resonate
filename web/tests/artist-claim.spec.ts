import { test, expect, injectMockAuth } from "./auth.setup";

const ARTIST_ID = "claim-guide-artist";
const artist = {
  id: ARTIST_ID,
  displayName: "Aya Lune",
  profileType: "public_artist",
  claimStatus: "unclaimed",
  imageUrl: null,
  summary: null,
  website: null,
  socialLinks: null,
};

test("public artist pages do not solicit claims from guests or signed-in listeners", async ({ page }) => {
  await page.route(`**/artists/${ARTIST_ID}`, (route) => route.fulfill({ json: { ...artist, claimStatus: undefined } }));
  await page.route(`**/catalog/artist/${ARTIST_ID}`, (route) => route.fulfill({ json: [] }));

  await page.goto(`/artist/${ARTIST_ID}`);
  await expect(page.getByRole("heading", { name: "Aya Lune" })).toBeVisible();
  await expect(page.getByText("Are you Aya Lune?")).toHaveCount(0);
  await expect(page.getByText("Unclaimed profile")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in to claim" })).toHaveCount(0);

  await injectMockAuth(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Aya Lune" })).toBeVisible();
  await expect(page.getByText("Are you Aya Lune?")).toHaveCount(0);
  await expect(page.getByText("Unclaimed profile")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /claim this profile/i })).toHaveCount(0);
});

test("signed-in requester selects the exact catalog profile and sees only their request status", async ({ authenticatedPage: page }) => {
  await page.route("**/management/me", (route) => route.fulfill({ json: {
    ownedArtists: [], managedArtists: [], ownedReleases: [], managedReleases: [],
    pendingGrants: [], pendingTransfers: [], outgoingTransfers: [],
  } }));
  await page.route("**/management/recoveries/me", (route) => route.fulfill({ json: { transfers: [] } }));
  await page.route("**/artists/claims/me", (route) => route.fulfill({ json: [] }));
  let searchCalls = 0;
  await page.route("**/artists/search?**", (route) => {
    searchCalls += 1;
    return searchCalls === 1
      ? route.fulfill({ status: 503, body: "Search unavailable" })
      : route.fulfill({ json: [artist, { ...artist, id: "same-name-other-artist" }] });
  });
  await page.route(`**/catalog/artist/${ARTIST_ID}`, (route) => route.fulfill({ json: [
    { id: "release-1", artistId: ARTIST_ID, title: "First Light", type: "EP", status: "ready", releaseDate: "2026-09-01T00:00:00.000Z", explicit: false, createdAt: "2026-09-01T00:00:00.000Z", tracks: [] },
  ] }));
  await page.route("**/catalog/artist/same-name-other-artist", (route) => route.fulfill({ json: [
    { id: "release-2", artistId: "same-name-other-artist", title: "Other Catalog", type: "EP", status: "ready", explicit: false, createdAt: "2026-09-01T00:00:00.000Z", tracks: [] },
  ] }));
  await page.route(`**/artists/${ARTIST_ID}/claims`, (route) => route.fulfill({ json: {
    id: "request-1", artistId: ARTIST_ID, status: "pending", createdAt: "2026-09-23T10:00:00.000Z", reviewedAt: null,
  } }));

  await page.goto("/artist/management");
  await expect(page.getByRole("heading", { name: "Request access to an artist profile" })).toBeVisible();
  await page.getByLabel("Find a credited profile").fill("Aya Lune");
  await expect(page.getByRole("alert").filter({ hasText: "Profile search is unavailable" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  const matches = page.getByRole("list", { name: "Matching artist profiles" }).getByRole("button");
  await expect(matches).toHaveCount(2);
  await matches.first().click();
  await expect(page.getByText("First Light", { exact: false })).toBeVisible();
  await expect(page.getByText("Other Catalog", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to evidence" }).click();
  await page.getByLabel("Evidence for review").fill("Official label reference and catalog ownership documentation.");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Pending review")).toBeVisible();
  await expect(page.getByText("Your profile requests").locator("..").getByText("pending", { exact: true })).toBeVisible();
});
