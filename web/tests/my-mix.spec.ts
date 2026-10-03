import { test, expect } from "./auth.setup";

const laneId = "lane_0123456789abcdef0123456789abcdef";
const sessionSettings = {
  socialMatchingEnabled: false,
  citySceneDiscoveryEnabled: false,
  agentPlaybackTrainingEnabled: true,
  recommendationExplanationPreference: "balanced",
  resetAt: null,
};

function tasteMemory() {
  return {
    schemaVersion: "listener-taste-memory/v1",
    settings: sessionSettings,
    summary: {
      favoredGenres: ["Soul"],
      favoredMoods: ["Warm"],
      favoredArtists: [],
      listeningLanes: [{
        id: laneId,
        label: "Soul · Warm",
        genreWeights: { Soul: 0.8 },
        moodWeights: { Warm: 0.7 },
        strength: 0.9,
        contexts: { "evening:weekday": 0.8 },
        energyBand: "medium",
        hidden: false,
      }],
      recentIntents: [],
      noveltyPattern: "Balanced discovery",
      commercePreference: "Listening first",
      explanationPreference: "balanced",
    },
    controls: [],
    privacy: { socialMatching: "disabled", citySceneDiscovery: "disabled", agentPlaybackTraining: "enabled", notes: [] },
  };
}

test("My Mix starts a session, carries live edits into the next pick, shows coverage, and saves only on request", async ({ authenticatedPage: page }) => {
  const sessionPreferences: Array<Record<string, unknown>> = [];
  const nextPreferences: Array<Record<string, unknown>> = [];
  const savedEdits: Array<Record<string, unknown>>[] = [];

  await page.route("**/agents/config", (route) => route.fulfill({ json: {
    id: "agent-1",
    userId: "listener-1",
    name: "Night DJ",
    vibes: ["Soul"],
    stemTypes: [],
    sessionMode: "curate",
    monthlyCapUsd: 5,
    spentUsd: 0,
    isActive: false,
    identityStatus: "local",
    identityChainId: null,
    identityRegistry: null,
    identityTokenId: null,
    identityTxHash: null,
    identityCredential: null,
  } }));
  await page.route("**/agents/config/history", (route) => route.fulfill({ json: [] }));
  await page.route("**/recommendations/taste-memory", (route) => route.fulfill({ json: tasteMemory() }));
  await page.route("**/agents/config/session/mix-vocabulary", (route) => route.fulfill({
    json: { genres: ["Dancehall", "Soul"], moods: ["Warm", "Zen"] },
  }));
  await page.route("**/agents/config/session", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { preferences?: Record<string, unknown> };
    if (body.preferences) sessionPreferences.push(body.preferences);
    await route.fulfill({ json: { status: "started", sessionId: "session-mix" } });
  });
  await page.route("**/agents/config/session/session-mix/mix-coverage", (route) => route.fulfill({
    json: { mixCoverage: { lanes: [{ id: laneId, label: "Soul · Warm", requested: 3, matched: 1 }] } },
  }));
  await page.route("**/sessions/agent/next", async (route) => {
    const body = route.request().postDataJSON() as { preferences?: Record<string, unknown> };
    if (body.preferences) nextPreferences.push(body.preferences);
    await route.fulfill({ json: {
      status: "no_tracks",
      reason: "all_candidates_recently_played",
      mixCoverage: { lanes: [{ id: laneId, label: "Soul · Warm", requested: 3, matched: 0 }] },
    } });
  });
  await page.route("**/recommendations/taste-memory/edits/apply", async (route) => {
    const body = route.request().postDataJSON() as { items: Array<Record<string, unknown>> };
    savedEdits.push(body.items);
    await route.fulfill({ json: { edits: { appliedCount: body.items.length, ignoredCount: 0 } } });
  });

  await page.goto("/#ai-dj");
  const section = page.locator("#ai-dj");
  await expect(section.getByRole("heading", { name: "Your AI DJ" })).toBeVisible();
  const panel = section.getByTestId("agent-session-panel");
  await expect(panel.getByRole("button", { name: "My Mix" })).toBeVisible();
  await panel.getByRole("button", { name: "My Mix" }).click();
  await panel.getByRole("button", { name: "Boost lane Soul · Warm" }).click();
  await panel.getByLabel("Add a genre or mood").selectOption("genre:Dancehall");
  await panel.getByRole("button", { name: "Add filter" }).click();
  await expect(panel.getByRole("list", { name: "Added session filters" }).getByText("Genre · Dancehall")).toBeVisible();
  expect(savedEdits).toHaveLength(0);

  await panel.locator(".aid-command-actions").getByRole("button", { name: "Start Session", exact: true }).click();
  await expect(panel.getByText("● Live")).toBeVisible();
  expect(sessionPreferences[0]?.myMix).toMatchObject({
    lanes: [{ id: laneId, boost: true }],
    additions: [{ genre: "Dancehall" }],
  });
  await expect(panel.getByTestId("agent-session-prompt").getByText("Only 1 of 3 picks matched Soul · Warm.")).toBeVisible();

  // Add another catalog filter while the session is live; it remains session-only.
  await panel.getByLabel("Add a genre or mood").selectOption("mood:Zen");
  await panel.getByRole("button", { name: "Add filter" }).click();
  await panel.getByRole("button", { name: "Next Pick" }).click();
  await expect(
    panel.locator(".aid-card--next-pick").getByRole("status", { name: "My Mix availability" })
      .getByText("Not enough new tracks for Soul · Warm yet."),
  ).toBeVisible();
  expect(nextPreferences[0]?.myMix).toMatchObject({
    lanes: [{ id: laneId, boost: true }],
    additions: [{ genre: "Dancehall" }, { mood: "Zen" }],
  });

  await panel.getByRole("button", { name: "Save to Taste Memory" }).click();
  await expect(panel.getByText(/Saved 4 preferences for future recommendations\./)).toBeVisible();
  expect(savedEdits).toEqual([[
    { signalType: "genre", value: "Dancehall", action: "boosted" },
    { signalType: "mood", value: "Zen", action: "boosted" },
    { signalType: "genre", value: "Soul", action: "boosted" },
    { signalType: "mood", value: "Warm", action: "boosted" },
  ]]);
  await expect(section).not.toContainText(laneId);
  await expect(section).not.toContainText("Listener Pro");
});
