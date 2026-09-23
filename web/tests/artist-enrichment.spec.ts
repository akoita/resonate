import { test, expect } from "./auth.setup";

const ARTIST_ID = "enrichment-guide-artist";
const CANDIDATE_ID = "f3be8e9e-542a-4e4c-a5b3-ea2d58123e71";
const profile = {
  id: ARTIST_ID,
  displayName: "Aya Lune",
  profileType: "public_artist",
  imageUrl: null,
  summary: "Original bio",
  website: null,
  socialLinks: null,
};

test("manager chooses an exact public identity and saves only approved suggestions", async ({ authenticatedPage: page }) => {
  let searches = 0;
  let suggestions = 0;
  let writes = 0;
  let savedSummary: string | null = null;
  await page.route(`**/artists/${ARTIST_ID}`, (route) => {
    if (route.request().method() === "PATCH") {
      writes += 1;
      const body = route.request().postDataJSON();
      savedSummary = body.summary;
      return route.fulfill({ json: { ...profile, ...body } });
    }
    return route.fulfill({ json: profile });
  });
  await page.route(`**/management/artists/${ARTIST_ID}/access`, (route) => route.fulfill({ json: {
    resourceType: "artist_profile", resourceId: ARTIST_ID,
    currentUserAccess: { isOwner: true, scopes: ["PROFILE_EDIT"] }, grants: [],
  } }));
  await page.route(`**/catalog/artist/${ARTIST_ID}`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/artists/${ARTIST_ID}/enrichment/candidates`, (route) => {
    searches += 1;
    return route.fulfill({ json: [
      { id: CANDIDATE_ID, name: "Aya Lune", area: "France", sourceUrl: `https://musicbrainz.org/artist/${CANDIDATE_ID}` },
      { id: "6226dc04-b38c-451a-86a8-8d5abddba733", name: "Aya Lune", disambiguation: "producer", area: "Canada", sourceUrl: "https://musicbrainz.org/artist/6226dc04-b38c-451a-86a8-8d5abddba733" },
    ] });
  });
  await page.route(`**/artists/${ARTIST_ID}/enrichment/suggestions`, (route) => {
    suggestions += 1;
    expect(route.request().postDataJSON()).toEqual({ candidateId: CANDIDATE_ID });
    return route.fulfill({ json: {
      candidate: { id: CANDIDATE_ID, name: "Aya Lune", area: "France", sourceUrl: `https://musicbrainz.org/artist/${CANDIDATE_ID}` },
      suggestions: [
        { field: "summary", value: "Source-backed draft bio", sourceUrl: "https://www.wikidata.org/wiki/Q1", sourceLabel: "Wikidata", confidence: "medium" },
        { field: "website", value: "https://ayalune.example", sourceUrl: `https://musicbrainz.org/artist/${CANDIDATE_ID}`, sourceLabel: "MusicBrainz", confidence: "medium" },
      ],
      warnings: [],
    } });
  });

  await page.goto(`/artist/${ARTIST_ID}`);
  await page.getByRole("button", { name: "Edit profile" }).click();
  expect(searches).toBe(0);
  expect(suggestions).toBe(0);
  await page.getByRole("button", { name: "Find suggestions" }).click();
  await expect(page.getByRole("radio")).toHaveCount(2);
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Review suggestions" }).click();
  await page.getByRole("checkbox", { name: /Bio/ }).check();
  await page.getByRole("checkbox", { name: /Website/ }).check();
  await page.getByRole("button", { name: /Add \d+ fields? to form/ }).click();
  await expect(page.locator(".artist-enrichment-error")).toContainText("Bio");
  await expect(page.getByLabel("Bio", { exact: true })).toHaveValue("Original bio");
  expect(writes).toBe(0);

  await page.getByRole("checkbox", { name: "Replace my existing bio" }).check();
  await page.getByRole("button", { name: /Add \d+ fields? to form/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 2 fields to your form" })).toBeVisible();
  await expect(page.getByLabel("Bio", { exact: true })).toHaveValue("Source-backed draft bio");
  await expect(page.getByLabel("Bio", { exact: true })).toHaveAccessibleDescription("Suggested");
  await expect(page.locator(".artist-profile-edit-field.is-suggested").filter({ has: page.getByLabel("Bio", { exact: true }) })).toContainText("Suggested");
  await expect(page.getByLabel("Website", { exact: true })).toHaveValue("https://ayalune.example");
  await page.getByRole("button", { name: "Back to suggestions" }).click();
  await page.getByLabel("Suggested Bio").fill("Revised source-backed bio");
  await expect(page.getByText("Your latest suggestion edits are not in the form yet.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Bio", { exact: true })).toHaveValue("Source-backed draft bio");
  await page.getByRole("button", { name: /Add \d+ fields? to form/ }).click();
  await expect(page.getByLabel("Bio", { exact: true })).toHaveValue("Revised source-backed bio");
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => writes).toBe(1);
  expect(savedSummary).toBe("Revised source-backed bio");
});

test("non-manager never sees the enrichment action", async ({ authenticatedPage: page }) => {
  await page.route(`**/artists/${ARTIST_ID}`, (route) => route.fulfill({ json: profile }));
  await page.route(`**/management/artists/${ARTIST_ID}/access`, (route) => route.fulfill({ status: 403, body: "Forbidden" }));
  await page.route(`**/catalog/artist/${ARTIST_ID}`, (route) => route.fulfill({ json: [] }));
  await page.goto(`/artist/${ARTIST_ID}`);
  await expect(page.getByRole("heading", { name: "Aya Lune" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit profile" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find suggestions" })).toHaveCount(0);
});

test("rate-limited candidate search can be retried without changing the profile", async ({ authenticatedPage: page }) => {
  let searches = 0;
  let writes = 0;
  await page.route(`**/artists/${ARTIST_ID}`, (route) => {
    if (route.request().method() === "PATCH") writes += 1;
    return route.fulfill({ json: profile });
  });
  await page.route(`**/management/artists/${ARTIST_ID}/access`, (route) => route.fulfill({ json: {
    resourceType: "artist_profile", resourceId: ARTIST_ID,
    currentUserAccess: { isOwner: true, scopes: ["PROFILE_EDIT"] }, grants: [],
  } }));
  await page.route(`**/catalog/artist/${ARTIST_ID}`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/artists/${ARTIST_ID}/enrichment/candidates`, (route) => {
    searches += 1;
    return searches === 1
      ? route.fulfill({ status: 429, json: { message: "Public source is rate limited. Try again shortly." } })
      : route.fulfill({ json: [] });
  });

  await page.goto(`/artist/${ARTIST_ID}`);
  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByRole("button", { name: "Find suggestions" }).click();
  await expect(page.locator(".artist-enrichment-error")).toContainText("try again");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("No public profiles matched this artist name.", { exact: false })).toBeVisible();
  expect(searches).toBe(2);
  expect(writes).toBe(0);
});
