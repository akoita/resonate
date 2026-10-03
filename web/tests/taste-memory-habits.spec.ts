import { test, expect } from "./auth.setup";

const settings = {
  socialMatchingEnabled: false,
  citySceneDiscoveryEnabled: false,
  agentPlaybackTrainingEnabled: true,
  recommendationExplanationPreference: "balanced",
  resetAt: null,
};

function lane(hidden: boolean, label = "Soul · Warm") {
  return {
    id: "lane_0123456789abcdef0123456789abcdef",
    label,
    genreWeights: { Soul: 0.8 },
    moodWeights: { Warm: 0.7 },
    strength: 0.9,
    contexts: { "evening:weekday": 0.8, "night:weekend": 0.3 },
    energyBand: "medium",
    hidden,
  };
}

function tasteMemory(lanes: ReturnType<typeof lane>[], controls: object[] = []) {
  return {
    schemaVersion: "listener-taste-memory/v1",
    settings,
    summary: {
      favoredGenres: ["Soul"],
      favoredMoods: ["Warm"],
      favoredArtists: ["Harbor Lights"],
      favoredEnergyBands: ["medium"],
      favoredTempoBands: ["mid"],
      contexts: [{ localHourBucket: "evening", weekdayKind: "weekday", favoredGenres: ["Soul"], favoredMoods: ["Warm"] }],
      listeningLanes: lanes,
      recentIntents: [],
      noveltyPattern: "Balanced discovery",
      commercePreference: "Listening first",
      explanationPreference: "balanced",
    },
    controls,
    privacy: { socialMatching: "disabled", citySceneDiscovery: "disabled", agentPlaybackTraining: "enabled", notes: [] },
  };
}

test("habit summaries render and reset clears learned dimensions while keeping declared edits", async ({ authenticatedPage: page }) => {
  const hiddenControl = {
    id: "hidden-lane-control",
    signalType: "lane",
    value: lane(true).id,
    action: "hidden",
    source: "settings",
    createdAt: "2026-10-01T12:00:00.000Z",
  };
  const declaredControl = {
    id: "declared-jazz",
    signalType: "genre",
    value: "Jazz",
    action: "boosted",
    source: "declared_text_edit",
    createdAt: "2026-10-01T12:00:00.000Z",
  };
  await page.route("**/recommendations/taste-memory", (route) => route.fulfill({ json: tasteMemory([lane(true)], [declaredControl, hiddenControl]) }));
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
  await expect(page.getByTestId("listening-lane-card")).toContainText("Soul · Warm");
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
  await expect(page.getByTestId("listening-lane-card")).toHaveCount(0);
  await expect(page.getByTestId("listening-lanes")).toContainText("Repeated listening sessions are needed");
  await expect(page.locator(".taste-memory-signal-list")).toContainText("Jazz");
  await expect(page.locator(".taste-memory-signal-list")).not.toContainText("Hidden listening lane");
  expect(resetRequests).toBe(1);
});

test("lane hide and restore persist through reloads using the existing signal-control API", async ({ authenticatedPage: page }) => {
  let laneHidden = false;
  let laneControl: object | null = null;
  let getRequests = 0;
  let postedBody: Record<string, unknown> | null = null;
  await page.route("**/recommendations/taste-memory", async (route) => {
    expect(route.request().method()).toBe("GET");
    getRequests += 1;
    await route.fulfill({ json: tasteMemory([lane(laneHidden)], laneControl ? [laneControl] : []) });
  });
  await page.route("**/recommendations/taste-memory/signals", async (route) => {
    expect(route.request().method()).toBe("POST");
    postedBody = route.request().postDataJSON() as Record<string, unknown>;
    laneHidden = true;
    laneControl = {
      id: "hidden-lane-control",
      signalType: "lane",
      value: lane(true).id,
      action: "hidden",
      source: "settings",
      createdAt: "2026-10-03T12:00:00.000Z",
    };
    await route.fulfill({ json: laneControl });
  });
  await page.route("**/recommendations/taste-memory/signals/hidden-lane-control", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    laneHidden = false;
    laneControl = null;
    await route.fulfill({ json: { status: "removed", control: { id: "hidden-lane-control" } } });
  });

  await page.goto("/settings");
  await page.locator(".settings-nav button").filter({ hasText: "Taste Memory" }).first().click();
  const laneCard = page.getByTestId("listening-lane-card");
  await expect(laneCard.getByRole("button", { name: "Hide from mixes" })).toBeVisible();
  await laneCard.getByRole("button", { name: "Hide from mixes" }).click();
  await expect(laneCard.getByRole("button", { name: "Restore to mixes" })).toBeVisible();
  expect(postedBody).toMatchObject({ signalType: "lane", value: lane(true).id, action: "hidden", source: "settings" });
  await expect(page.locator("body")).not.toContainText(lane(true).id);
  expect(getRequests).toBeGreaterThanOrEqual(2);

  await laneCard.getByRole("button", { name: "Restore to mixes" }).click();
  await expect(laneCard.getByRole("button", { name: "Hide from mixes" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(lane(true).id);
  expect(getRequests).toBeGreaterThanOrEqual(3);
});

test("restoring an ordinary taste control reloads lane summaries", async ({ authenticatedPage: page }) => {
  let restored = false;
  await page.route("**/recommendations/taste-memory", async (route) => {
    await route.fulfill({
      json: tasteMemory(
        [lane(false, restored ? "Updated Soul · Warm" : "Soul · Warm")],
        restored ? [] : [{
          id: "hidden-rock-control",
          signalType: "genre",
          value: "Rock",
          action: "hidden",
          source: "settings",
          createdAt: "2026-10-01T12:00:00.000Z",
        }],
      ),
    });
  });
  await page.route("**/recommendations/taste-memory/signals/hidden-rock-control", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    restored = true;
    await route.fulfill({ json: { status: "removed", control: { id: "hidden-rock-control" } } });
  });

  await page.goto("/settings");
  await page.locator(".settings-nav button").filter({ hasText: "Taste Memory" }).first().click();
  await expect(page.getByTestId("listening-lane-card")).toContainText("Soul · Warm");
  await page.getByRole("button", { name: "Restore: Rock" }).click();
  await expect(page.getByTestId("listening-lane-card")).toContainText("Updated Soul · Warm");
});
