import { expect, test } from "./auth.setup";

const savedTracks = [
  { id: "library-a-1", userId: "test-user", source: "remote", title: "First song", artist: "Artist A", albumArtist: "Artist A", album: "Album A", createdAt: "2026-09-01T12:00:00.000Z" },
  { id: "library-a-2", userId: "test-user", source: "remote", title: "Second song", artist: "Artist A", albumArtist: "Artist A", album: "Album A", createdAt: "2026-09-01T12:00:00.000Z" },
  { id: "library-b-1", userId: "test-user", source: "remote", title: "Other song", artist: "Artist B", albumArtist: "Artist B", album: "Album B", createdAt: "2026-09-01T12:00:00.000Z" },
];

test("a failed single removal leaves the saved track visible", async ({ authenticatedPage: page }) => {
  await page.route("**/library/tracks", route => route.fulfill({ json: savedTracks }));
  await page.route("**/library/tracks/library-a-1", route => route.fulfill({ status: 500, json: { message: "Unavailable" } }));
  await page.goto("/library", { waitUntil: "domcontentloaded" });

  const row = page.locator(".library-item").filter({ hasText: "First song" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Remove from library" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove from library" }).click();

  await expect(page.getByText("Could not remove")).toBeVisible();
  await expect(row).toBeVisible();
});

test("a listener can remove a track from the row menu at phone width", async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/library/tracks", route => route.fulfill({ json: savedTracks }));
  await page.route("**/library/tracks/library-a-1", route => route.fulfill({ json: { id: "library-a-1" } }));
  await page.goto("/library?tab=tracks", { waitUntil: "domcontentloaded" });

  const row = page.locator(".library-item").filter({ hasText: "First song" });
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Remove from library" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove from library" }).click();

  await expect(row).toHaveCount(0);
  await expect(page.locator(".library-item").filter({ hasText: "Second song" })).toBeVisible();
});

test("removing an artist sends exactly its saved tracks and updates the groups", async ({ authenticatedPage: page }) => {
  let removedIds: string[] = [];
  await page.route("**/library/tracks", route => route.fulfill({ json: savedTracks }));
  await page.route("**/library/tracks/batch", async route => {
    removedIds = (route.request().postDataJSON() as { ids: string[] }).ids;
    await route.fulfill({ json: { count: removedIds.length } });
  });
  await page.goto("/library?tab=artists", { waitUntil: "domcontentloaded" });

  const card = page.locator(".library-card").filter({ hasText: "Artist A" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Remove from library" }).click();
  await expect(page.getByRole("dialog")).toContainText("2 tracks will be removed");
  await page.getByRole("dialog").getByRole("button", { name: "Remove from library" }).click();

  await expect(card).toHaveCount(0);
  await expect(page.locator(".library-card").filter({ hasText: "Artist B" })).toBeVisible();
  expect(removedIds).toEqual(["library-a-1", "library-a-2"]);
});

test("an album menu removes only that album's tracks", async ({ authenticatedPage: page }) => {
  let removedIds: string[] = [];
  await page.route("**/library/tracks", route => route.fulfill({ json: savedTracks }));
  await page.route("**/library/tracks/batch", async route => {
    removedIds = (route.request().postDataJSON() as { ids: string[] }).ids;
    await route.fulfill({ json: { count: removedIds.length } });
  });
  await page.goto("/library?tab=albums", { waitUntil: "domcontentloaded" });

  const card = page.locator(".library-card").filter({ hasText: "Album A" });
  await card.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Remove from library" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove from library" }).click();

  await expect(card).toHaveCount(0);
  await expect(page.locator(".library-card").filter({ hasText: "Album B" })).toBeVisible();
  expect(removedIds).toEqual(["library-a-1", "library-a-2"]);
});

test("checkbox selection exposes bulk removal for the selected tracks", async ({ authenticatedPage: page }) => {
  let removedIds: string[] = [];
  await page.route("**/library/tracks", route => route.fulfill({ json: savedTracks }));
  await page.route("**/library/tracks/batch", async route => {
    removedIds = (route.request().postDataJSON() as { ids: string[] }).ids;
    await route.fulfill({ json: { count: removedIds.length } });
  });
  await page.goto("/library?tab=tracks", { waitUntil: "domcontentloaded" });

  await page.locator(".library-item").filter({ hasText: "First song" }).getByRole("checkbox").check();
  await page.locator(".library-item").filter({ hasText: "Other song" }).getByRole("checkbox").check();
  await page.locator(".library-selection-bar").getByRole("button", { name: "Remove 2 tracks" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove from library" }).click();

  await expect(page.locator(".library-item").filter({ hasText: "Second song" })).toBeVisible();
  expect(removedIds).toEqual(["library-a-1", "library-b-1"]);
});

test("owned stems explain why they stay in the library", async ({ authenticatedPage: page }) => {
  const owned = { ...savedTracks[0], id: "owned-stem", title: "Owned mix", isOwned: true, stemType: "original", tokenId: "1" };
  let deleteCalled = false;
  await page.route("**/library/tracks", route => route.fulfill({ json: [owned] }));
  await page.route("**/library/tracks/owned-stem", async route => {
    deleteCalled = true;
    await route.fulfill({ status: 500 });
  });
  await page.goto("/library?tab=tracks", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Show Stems").check();

  const row = page.locator(".library-item").filter({ hasText: "Owned mix" });
  await expect(row.getByRole("checkbox")).toBeDisabled();
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Why can't I remove this?" }).click();

  await expect(page.getByText("Owned stems stay in your library while you hold them.")).toBeVisible();
  expect(deleteCalled).toBe(false);
});
