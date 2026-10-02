import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./auth.setup";
import {
  CRATE_ID,
  CRATE_REQUEST_TEXT,
  REFERENCE_CRATE_ID,
  REFERENCE_TRACK_ID,
  mockCrateApi,
} from "./fixtures/crate-digger-mock.mjs";

/**
 * Crate Digger pages (#1963) against a fully mocked crate API: no backend data
 * is needed. The mock is shared with the User Guide screenshot capture.
 */

// Headless Chromium must start the AudioContext without a user gesture.
test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

test.describe("Crate Digger (#1963)", () => {
  test("build, shape, save and swap a crate", async ({ authenticatedPage: page }) => {
    const { patches, swaps, created } = await mockCrateApi(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/crates");

    await expect(page.getByRole("heading", { name: "Crate Digger", level: 1 })).toBeVisible();
    await expect(page.getByText("No crates yet.")).toBeVisible();
    const build = page.getByRole("button", { name: "Build crate" });
    await expect(build).toBeDisabled();

    // Build from a sentence.
    await page.getByLabel("What does your set need?").fill(CRATE_REQUEST_TEXT);
    await build.click();
    await page.waitForURL(`**/crates/${CRATE_ID}`);
    expect(created).toEqual([{ text: CRATE_REQUEST_TEXT, count: 8 }]);

    // Coverage banner and filter chips.
    await expect(page.getByRole("heading", { name: "Untitled crate", level: 1 })).toBeVisible();
    const banner = page.getByRole("region", { name: "How well your request was matched" });
    await expect(banner.getByText("6 of 8 found")).toBeVisible();
    await expect(banner.getByText("Key match held back 2")).toBeVisible();
    await expect(banner.getByText("Per-line price cap held back 1")).toBeVisible();
    await expect(banner.getByText("“melodic house”")).toBeVisible();
    const chips = page.locator(".crates-chips");
    await expect(chips.getByText("122-128 BPM")).toBeVisible();
    await expect(chips.getByText("Key 8A")).toBeVisible();
    await expect(chips.getByText("Has vocals stem")).toBeVisible();
    await expect(chips.getByText("Up to $20.00 per line")).toBeVisible();

    // Six lines with their measured details; one is unavailable.
    const lines = page.locator(".crates-line");
    await expect(lines).toHaveCount(6);
    const titles = lines.locator(".crates-line-title");
    await expect(titles).toHaveText([
      "Neon Drift",
      "Glass Harbour",
      "Midnight Courier",
      "Paper Lanterns",
      "Saltwater",
      "Last Train to Nowhere",
    ]);
    const lineFor = (trackId: string) => page.locator(`.crates-line[data-track-id="${trackId}"]`);
    const neon = lineFor("track-neon-drift");
    await expect(neon.getByText("122 BPM", { exact: true })).toBeVisible();
    await expect(neon.getByText("Key 8A", { exact: true })).toBeVisible();
    await expect(neon.getByText("Energy 42%", { exact: true })).toBeVisible();
    await expect(neon.getByText("Vocals · quality 82/100")).toBeVisible();
    await expect(lineFor("track-saltwater").getByText("Energy unknown", { exact: true })).toBeVisible();
    const unavailable = lineFor("track-paper-lanterns");
    await expect(unavailable.getByText("Unavailable", { exact: true })).toBeVisible();
    await expect(unavailable.getByRole("button", { name: /^Preview the transition/ })).toHaveCount(0);

    // License grants and the honest "no standard terms" text.
    await neon.getByText(/^License options/).click();
    await expect(neon.getByText("Use in derivative works, publish remixes")).toBeVisible();
    await expect(neon.getByText("Includes personal rights").first()).toBeVisible();
    const glass = lineFor("track-glass-harbour");
    await glass.getByText(/^License options/).click();
    await expect(
      glass.getByText("No standard terms yet — check the listing before buying"),
    ).toBeVisible();
    await expect(glass.getByText("Price is indicative; the quote sets the final price")).toBeVisible();

    // Move a line down: the order changes on screen, nothing is sent yet.
    await page.getByRole("button", { name: 'Move "Neon Drift" down' }).click();
    await expect(titles.first()).toHaveText("Glass Harbour");
    await expect(titles.nth(1)).toHaveText("Neon Drift");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    expect(patches).toHaveLength(0);

    // Lock a line.
    const lock = page.getByRole("button", { name: 'Lock "Midnight Courier" in place' });
    await lock.click();
    await expect(page.getByRole("button", { name: 'Unlock "Midnight Courier"' })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByRole("button", { name: 'Swap "Midnight Courier" for a similar track' }),
    ).toBeDisabled();

    // Remove a line through the confirm dialog.
    await page.getByRole("button", { name: 'Remove "Paper Lanterns" from the crate' }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Remove this line?")).toBeVisible();
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(titles).toHaveCount(5);
    await expect(page.getByText("Paper Lanterns")).toHaveCount(0);

    // Title and save.
    await page.getByLabel("Crate title").fill("Friday warm-up");
    await page.getByRole("button", { name: "Save crate" }).click();
    await expect(page.getByText("Crate saved")).toBeVisible();
    expect(patches).toHaveLength(1);
    expect(patches[0]).toEqual({
      crateId: CRATE_ID,
      body: {
        title: "Friday warm-up",
        items: [
          { trackId: "track-glass-harbour", locked: false },
          { trackId: "track-neon-drift", locked: false },
          { trackId: "track-midnight-courier", locked: true },
          { trackId: "track-saltwater", locked: false },
          { trackId: "track-last-train", locked: false },
        ],
        status: "saved",
      },
    });
    await expect(page.getByRole("heading", { name: "Friday warm-up", level: 1 })).toBeVisible();
    await expect(page.getByText("5 lines · Saved")).toBeVisible();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
    await expect(titles).toHaveText([
      "Glass Harbour",
      "Neon Drift",
      "Midnight Courier",
      "Saltwater",
      "Last Train to Nowhere",
    ]);

    // Swap a line for a similar track.
    await page.getByRole("button", { name: 'Swap "Saltwater" for a similar track' }).click();
    await expect(page.getByText("Swapped for a similar track")).toBeVisible();
    expect(swaps).toEqual([{ crateId: CRATE_ID, trackId: "track-saltwater" }]);
    await expect(titles.nth(3)).toHaveText("Copper Sky");
    await expect(page.getByText("Saltwater")).toHaveCount(0);
    // The lock survived the round trip.
    await expect(page.getByRole("button", { name: 'Unlock "Midnight Courier"' })).toBeVisible();

    // The crate is in the list.
    await page.getByRole("link", { name: "Your crates" }).click();
    await expect(page.getByRole("link", { name: /Friday warm-up/ })).toBeVisible();
    await expect(page.getByText(/5 lines · Saved/)).toBeVisible();
  });

  test("a stem page's reference-track link builds a crate on arrival", async ({
    authenticatedPage: page,
  }) => {
    const { created } = await mockCrateApi(page);
    await page.goto("/crates");
    await expect(page.getByRole("heading", { name: "Crate Digger", level: 1 })).toBeVisible();
    // The stem page links here with the catalog track id.
    await page.goto(`/crates?referenceTrackId=${encodeURIComponent(REFERENCE_TRACK_ID)}`);
    await page.waitForURL(`**/crates/${REFERENCE_CRATE_ID}`);
    expect(created).toEqual([{ referenceTrackId: REFERENCE_TRACK_ID, count: 8 }]);
    await expect(page.getByText("6 of 8 found")).toBeVisible();
    await expect(page.locator(".crates-line")).toHaveCount(6);

    // Back returns to where the link was followed from, not into another build.
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Crate Digger", level: 1 })).toBeVisible();
    await page.waitForTimeout(500);
    expect(created).toHaveLength(1);
  });

  test("edit filters and build a new crate from them", async ({ authenticatedPage: page }) => {
    const { created, patches } = await mockCrateApi(page);
    await page.goto("/crates");
    await page.getByLabel("What does your set need?").fill(CRATE_REQUEST_TEXT);
    await page.getByRole("button", { name: "Build crate" }).click();
    await page.waitForURL(`**/crates/${CRATE_ID}`);

    const rebuild = page.getByRole("button", { name: "Build a new crate with these filters" });
    await expect(rebuild).toBeDisabled();

    // Remove a chip and widen the tempo range; the original crate is left alone.
    await page.getByRole("button", { name: "Remove filter Up to $20.00 per line" }).click();
    await expect(page.locator(".crates-chips").getByText("Up to $20.00 per line")).toHaveCount(0);
    await page.getByLabel("Highest BPM").fill("132");
    await expect(page.locator(".crates-chips").getByText("122-132 BPM")).toBeVisible();
    await expect(rebuild).toBeEnabled();
    await rebuild.click();

    await page.waitForURL(/\/crates\/e2e-crate-\d+$/);
    expect(created).toHaveLength(2);
    expect(created[1]).toEqual({
      filters: {
        count: 8,
        bpm: { min: 122, max: 132 },
        keys: ["8A", "9A"],
        includeCamelotNeighbors: true,
        energy: null,
        requiredStems: ["vocals"],
        licenseType: null,
        maxTotalUsd: null,
        maxPerItemUsd: null,
        verifiedHumanOnly: false,
        allowFullyAi: false,
        genres: [],
        moods: [],
      },
    });
    expect(patches).toHaveLength(0);
    await expect(page.getByRole("heading", { name: "Untitled crate", level: 1 })).toBeVisible();
  });

  test("a swap sends pending edits first, and a locked line cannot be swapped", async ({
    authenticatedPage: page,
  }) => {
    const { patches, swaps } = await mockCrateApi(page);
    await page.goto("/crates");
    await page.getByLabel("What does your set need?").fill(CRATE_REQUEST_TEXT);
    await page.getByRole("button", { name: "Build crate" }).click();
    await page.waitForURL(`**/crates/${CRATE_ID}`);

    await page.getByRole("button", { name: 'Lock "Neon Drift" in place' }).click();
    await expect(
      page.getByRole("button", { name: 'Swap "Neon Drift" for a similar track' }),
    ).toBeDisabled();
    await page.getByRole("button", { name: 'Move "Last Train to Nowhere" up' }).click();
    await page.getByRole("button", { name: 'Swap "Saltwater" for a similar track' }).click();
    await expect(page.getByText("Swapped for a similar track")).toBeVisible();

    // The unsaved lock and order went to the server before the swap, as a draft.
    expect(patches).toHaveLength(1);
    expect(patches[0].body.status).toBeUndefined();
    expect(patches[0].body.items?.[0]).toEqual({ trackId: "track-neon-drift", locked: true });
    expect(swaps).toEqual([{ crateId: CRATE_ID, trackId: "track-saltwater" }]);
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
    await expect(page.locator(".crates-line-title")).toHaveText([
      "Neon Drift",
      "Glass Harbour",
      "Midnight Courier",
      "Paper Lanterns",
      "Last Train to Nowhere",
      "Copper Sky",
    ]);
  });

  test("a transition preview plays and stops", async ({ authenticatedPage: page }) => {
    await mockCrateApi(page);
    await page.goto("/crates");
    await page.getByLabel("What does your set need?").fill(CRATE_REQUEST_TEXT);
    await page.getByRole("button", { name: "Build crate" }).click();
    await page.waitForURL(`**/crates/${CRATE_ID}`);

    // Neon Drift into Glass Harbour: both have audio. Midnight Courier into the
    // unavailable Paper Lanterns has no preview button.
    await expect(
      page.getByRole("button", { name: /^Preview the transition from "Midnight Courier"/ }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: 'Preview the transition from "Neon Drift" into "Glass Harbour"' })
      .click();
    await expect(page.getByRole("button", { name: "Stop the transition preview" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Stop the transition preview" }).click();
    await expect(
      page.getByRole("button", { name: 'Preview the transition from "Neon Drift" into "Glass Harbour"' }),
    ).toBeVisible();
  });

  test("the request page and a crate page have no serious automated accessibility violations", async ({
    authenticatedPage: page,
  }) => {
    await mockCrateApi(page);
    const blocking = async () => {
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      return results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.html) }));
    };

    await page.goto("/crates");
    await expect(page.getByRole("heading", { name: "Crate Digger", level: 1 })).toBeVisible();
    await expect(page.getByText("No crates yet.")).toBeVisible();
    expect(await blocking()).toEqual([]);

    await page.getByLabel("What does your set need?").fill(CRATE_REQUEST_TEXT);
    await page.getByRole("button", { name: "Build crate" }).click();
    await page.waitForURL(`**/crates/${CRATE_ID}`);
    await expect(page.locator(".crates-line")).toHaveCount(6);
    await page.locator(".crates-line").nth(1).getByText(/^License options/).click();
    await page.getByRole("button", { name: 'Lock "Midnight Courier" in place' }).click();
    expect(await blocking()).toEqual([]);
  });

  test("an unknown crate says so", async ({ authenticatedPage: page }) => {
    await mockCrateApi(page);
    await page.goto("/crates/does-not-exist");
    await expect(page.getByRole("heading", { name: "Crate not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to your crates" })).toBeVisible();
  });
});
