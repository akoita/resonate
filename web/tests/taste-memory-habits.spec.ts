import { test, expect } from "./auth.setup";

test("habit summaries render and reset clears learned dimensions while keeping declared edits", async ({ authenticatedPage: page }) => {
  const settings = { socialMatchingEnabled: false, citySceneDiscoveryEnabled: false, agentPlaybackTrainingEnabled: true, recommendationExplanationPreference: "balanced", resetAt: null };
  await page.route("**/recommendations/taste-memory", (route) => route.fulfill({ json: {
    schemaVersion: "listener-taste-memory/v1", settings,
    summary: {
      favoredGenres: ["Soul"], favoredMoods: ["Warm"], favoredArtists: ["Harbor Lights"],
      favoredEnergyBands: ["medium"], favoredTempoBands: ["mid"],
      contexts: [{ localHourBucket: "evening", weekdayKind: "weekday", favoredGenres: ["Soul"], favoredMoods: ["Warm"] }],
      recentIntents: [], noveltyPattern: "Balanced discovery", commercePreference: "Listening first", explanationPreference: "balanced",
    },
    controls: [{ id: "declared-jazz", signalType: "genre", value: "Jazz", action: "boosted", source: "declared_text_edit", createdAt: "2026-10-01T12:00:00.000Z" }],
    privacy: { socialMatching: "disabled", citySceneDiscovery: "disabled", agentPlaybackTraining: "enabled", notes: [] },
  } }));
  let resetRequests = 0;
  await page.route("**/recommendations/taste-memory/reset", async (route) => {
    expect(route.request().method()).toBe("POST");
    resetRequests += 1;
    await route.fulfill({ json: { ...settings, resetAt: "2026-10-03T12:00:00.000Z" } });
  });

  await page.goto("/settings");
  await page.locator(".settings-nav button").filter({ hasText: "Taste Memory" }).first().click();
  const stat = (label: string) => page.locator(".taste-memory-stat").filter({ has: page.locator("span", { hasText: new RegExp(`^${label}$`) }) });
  await expect(stat("Moods")).toContainText("Warm");
  await expect(stat("Artists")).toContainText("Harbor Lights");
  await expect(stat("Energy")).toContainText("Medium");
  await expect(stat("Tempo")).toContainText("Medium");
  await expect(stat("Evenings · weekdays")).toContainText("Soul");
  await expect(page.locator(".taste-memory-signal-list")).toContainText("Jazz");

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Reset taste memory?" });
  await expect(dialog).toBeVisible();
  expect(resetRequests).toBe(0);
  await dialog.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(stat("Genres")).toContainText("Not enough signal yet");
  for (const label of ["Moods", "Artists", "Energy", "Tempo"]) {
    await expect(stat(label)).toContainText("Not enough signal yet");
  }
  await expect(stat("Evenings · weekdays")).toHaveCount(0);
  await expect(page.locator(".taste-memory-signal-list")).toContainText("Jazz");
  expect(resetRequests).toBe(1);
});
