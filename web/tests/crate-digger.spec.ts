import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./auth.setup";
import {
  CRATE_ID,
  CRATE_REQUEST_TEXT,
  MOCK_BUYER,
  MOCK_QUOTE_HASH,
  REFERENCE_CRATE_ID,
  REFERENCE_TRACK_ID,
  mockCrate,
  mockCrateApi,
  settledQuote,
  WATCH_DENIED,
  watchingWatch,
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
    // Lines left empty: the number in the sentence (or the default) decides.
    expect(created).toEqual([{ text: CRATE_REQUEST_TEXT }]);

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
    // The line is gone from the set (the export panel below still reads the saved crate).
    await expect(page.locator(".crates-line").getByText("Paper Lanterns")).toHaveCount(0);

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
    await page.getByLabel("Lines").fill("5");
    await page.getByRole("button", { name: "Build crate" }).click();
    await page.waitForURL(`**/crates/${CRATE_ID}`);
    expect(created[0]).toEqual({ text: CRATE_REQUEST_TEXT, count: 5 });

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

    // The quote panel, with a quote on screen and at the confirm step.
    await page.getByRole("button", { name: "Save crate" }).click();
    await expect(page.getByText("Crate saved")).toBeVisible();
    await page.getByRole("button", { name: "Get a quote" }).click();
    await expect(page.locator(".crates-quote-line").first()).toBeVisible();
    expect(await blocking()).toEqual([]);
    await page.getByRole("button", { name: "Approve and buy" }).click();
    await expect(page.getByRole("heading", { name: "Confirm your purchase" })).toBeVisible();
    expect(await blocking()).toEqual([]);
  });

  test("an unknown crate says so", async ({ authenticatedPage: page }) => {
    await mockCrateApi(page);
    await page.goto("/crates/does-not-exist");
    await expect(page.getByRole("heading", { name: "Crate not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to your crates" })).toBeVisible();
  });
});

test.describe("Crate quote (#1964)", () => {
  // The signing path itself (wallet, bundler, chain) cannot run under mock auth:
  // it is covered by the unit tests of the plan, the preflight and the purchase
  // sequence. These tests cover what the DJ sees and what is sent to the API.
  async function buildCrate(page: import("@playwright/test").Page) {
    await page.goto("/crates");
    await page.getByLabel("What does your set need?").fill(CRATE_REQUEST_TEXT);
    await page.getByRole("button", { name: "Build crate" }).click();
    await page.waitForURL(`**/crates/${CRATE_ID}`);
    await expect(page.locator(".crates-line")).toHaveCount(6);
  }

  const panel = (page: import("@playwright/test").Page) =>
    page.getByRole("region", { name: "Buy this crate" });
  const quoteLine = (page: import("@playwright/test").Page, trackId: string) =>
    page.locator(`.crates-quote-line[data-track-id="${trackId}"]`);

  test("a quote shows each line's price, split, rights, dropped stems and totals", async ({
    authenticatedPage: page,
  }) => {
    const { quoteRequests } = await mockCrateApi(page);
    await buildCrate(page);

    await panel(page).getByRole("button", { name: "Get a quote" }).click();
    await expect(panel(page).getByRole("heading", { name: "Your quote" })).toBeVisible();
    // The page asks for the account it will sign with, and nothing else on a first quote.
    expect(quoteRequests).toHaveLength(1);
    expect(quoteRequests[0].crateId).toBe(CRATE_ID);
    expect(quoteRequests[0].body).toEqual({ buyerAddress: MOCK_BUYER });

    const neon = quoteLine(page, "track-neon-drift");
    await expect(neon.getByText("Vocals", { exact: true }).first()).toBeVisible();
    await expect(neon.getByText("0.5 USDC (about $0.50)")).toBeVisible();
    await expect(neon.getByText("Artist side 0.45 USDC")).toBeVisible();
    await expect(neon.getByText(/Platform fee 0\.05 USDC/)).toBeVisible();
    await expect(neon.getByText("Stream & collect — personal listening")).toBeVisible();
    await expect(neon.getByLabel("License for Neon Drift")).toHaveValue("personal");

    // A sold-out stem and an unavailable track say why, in plain words.
    await expect(quoteLine(page, "track-midnight-courier").getByText("Not in this quote: Sold out")).toBeVisible();
    await expect(
      quoteLine(page, "track-paper-lanterns").getByText("Not in this quote: Not for sale at this license"),
    ).toBeVisible();

    // Four stems are on offer at $0.50 each.
    await expect(panel(page).getByText("Total in USDC")).toBeVisible();
    await expect(panel(page).getByLabel("Quote total").getByText("2 USDC (about $2.00)")).toBeVisible();
    await expect(panel(page).getByText(/^Prices are good for \d+:\d\d$/)).toBeVisible();
    await expect(panel(page).getByText(/Over your/)).toHaveCount(0);

    // Approve opens a confirm step that lists exactly what will be bought.
    await panel(page).getByRole("button", { name: "Approve and buy" }).click();
    const confirm = panel(page).getByRole("group", { name: "Confirm your purchase" });
    await expect(confirm.getByText("You are about to buy 4 stems:")).toBeVisible();
    await expect(confirm.getByText(/^Neon Drift: Vocals \(Personal\) for 0\.5 USDC$/)).toBeVisible();
    await expect(confirm.getByText(/^Midnight Courier/)).toHaveCount(0);
    await expect(confirm.getByRole("button", { name: "Confirm and sign" })).toBeEnabled();
    await confirm.getByRole("button", { name: "Back" }).click();
    await expect(panel(page).getByRole("button", { name: "Approve and buy" })).toBeVisible();
    expect(quoteRequests).toHaveLength(1);
  });

  test("changing a line's license or stems re-quotes every line", async ({ authenticatedPage: page }) => {
    const { quoteRequests } = await mockCrateApi(page);
    await buildCrate(page);
    await panel(page).getByRole("button", { name: "Get a quote" }).click();
    await expect(quoteLine(page, "track-neon-drift")).toBeVisible();

    // A different license on one line: the request carries every line.
    await quoteLine(page, "track-neon-drift").getByLabel("License for Neon Drift").selectOption("remix");
    await expect(quoteLine(page, "track-neon-drift").getByText("2 USDC (about $2.00)")).toBeVisible();
    expect(quoteRequests).toHaveLength(2);
    expect(quoteRequests[1].body.buyerAddress).toBe(MOCK_BUYER);
    expect(quoteRequests[1].body.lines).toHaveLength(6);
    expect(quoteRequests[1].body.lines[0]).toEqual({
      trackId: "track-neon-drift",
      licenseType: "remix",
      stemTypes: ["vocals"],
    });
    await expect(panel(page).getByLabel("Quote total").getByText("3.5 USDC (about $3.50)")).toBeVisible();
    await expect(quoteLine(page, "track-neon-drift").getByText("Use in derivative works, publish remixes")).toBeVisible();

    // One more stem on another line.
    await quoteLine(page, "track-glass-harbour").getByLabel("Drums").click();
    await expect(quoteLine(page, "track-glass-harbour").locator(".crates-quote-item")).toHaveCount(2);
    expect(quoteRequests).toHaveLength(3);
    const glass = quoteRequests[2].body.lines.find((line: { trackId: string }) => line.trackId === "track-glass-harbour");
    expect(glass).toEqual({ trackId: "track-glass-harbour", licenseType: "personal", stemTypes: ["vocals", "drums"] });
    // The earlier choice is kept.
    expect(quoteRequests[2].body.lines[0]).toMatchObject({ trackId: "track-neon-drift", licenseType: "remix" });
    await expect(panel(page).getByLabel("Quote total").getByText("4 USDC (about $4.00)")).toBeVisible();
  });

  test("an expired quote cannot be approved and asks for a new one", async ({ authenticatedPage: page }) => {
    const { quoteRequests, expireNextQuoteIn } = await mockCrateApi(page);
    await buildCrate(page);
    expireNextQuoteIn(-1_000);

    await panel(page).getByRole("button", { name: "Get a quote" }).click();
    await expect(panel(page).getByText("This quote has expired. Get a new quote.")).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Approve and buy" })).toHaveCount(0);

    await panel(page).getByRole("button", { name: "Get a new quote" }).click();
    await expect(panel(page).getByText(/^Prices are good for \d+:\d\d$/)).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Approve and buy" })).toBeEnabled();
    expect(quoteRequests).toHaveLength(2);
  });

  test("a quote over the crate's budget says so", async ({ authenticatedPage: page }) => {
    const { crates } = await mockCrateApi(page);
    await buildCrate(page);
    const crate = crates.get(CRATE_ID);
    if (!crate) throw new Error("The mock crate is missing");
    crate.filters.maxTotalUsd = 1;

    await panel(page).getByRole("button", { name: "Get a quote" }).click();
    await expect(panel(page).getByText("Over your $1.00 budget")).toBeVisible();
    await panel(page).getByRole("button", { name: "Approve and buy" }).click();
    await expect(
      panel(page).getByRole("group", { name: "Confirm your purchase" }).getByText("Over your $1.00 budget"),
    ).toBeVisible();
  });

  test("unsaved changes must be saved before a quote", async ({ authenticatedPage: page }) => {
    const { quoteRequests } = await mockCrateApi(page);
    await buildCrate(page);
    await page.getByRole("button", { name: 'Move "Neon Drift" down' }).click();
    await expect(panel(page).getByRole("button", { name: "Get a quote" })).toBeDisabled();
    await expect(panel(page).getByText(/Save your changes first/)).toBeVisible();
    await page.getByRole("button", { name: "Save crate" }).click();
    await expect(page.getByText("Crate saved")).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Get a quote" })).toBeEnabled();
    expect(quoteRequests).toHaveLength(0);
  });

  test("a settled quote shows its receipts when the crate is reopened", async ({
    authenticatedPage: page,
  }) => {
    const crate = mockCrate("e2e-receipts", { title: "Sunday sunset set", status: "saved" });
    await mockCrateApi(page, {
      savedCrates: [crate],
      latestQuotes: { "e2e-receipts": settledQuote(crate) },
    });
    await page.goto("/crates/e2e-receipts");
    await expect(page.getByRole("heading", { name: "Sunday sunset set", level: 1 })).toBeVisible();

    const receipts = panel(page).getByRole("region", { name: "Receipts" });
    await expect(receipts.getByText(/^Bought 2 stems\./)).toBeVisible();
    await expect(receipts.getByText("Left out: the listing changed")).toBeVisible();
    await expect(receipts.getByText("Not part of the purchase")).toBeVisible();
    await expect(receipts.getByText("Bought for 0.5 USDC").first()).toBeVisible();
    await expect(receipts.getByText(`Transaction ${MOCK_QUOTE_HASH.slice(0, 8)}`).first()).toBeVisible();
    // Nothing from a finished purchase can be approved again.
    await expect(panel(page).getByRole("button", { name: "Approve and buy" })).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: "Get a new quote" })).toBeVisible();
  });
});

test.describe("Crate export (#1965)", () => {
  const SAVED_ID = "e2e-export";
  const FOLDER = "/Users/dj/Music/Resonate";

  const panel = (page: import("@playwright/test").Page) =>
    page.getByRole("region", { name: "Export to rekordbox or Serato" });

  async function openSavedCrate(
    page: import("@playwright/test").Page,
    options: { ownsNothing?: boolean } = {},
  ) {
    const crate = mockCrate(SAVED_ID, { title: "Friday warm-up", status: "saved" });
    const mock = await mockCrateApi(page, { savedCrates: [crate], ...options });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/crates/${SAVED_ID}`);
    await expect(page.getByRole("heading", { name: "Friday warm-up", level: 1 })).toBeVisible();
    return mock;
  }

  test("lists the stems you own with their file names, and explains each skipped line", async ({
    authenticatedPage: page,
  }) => {
    await openSavedCrate(page);
    const entries = panel(page).getByRole("list", { name: "Stems you can export" });
    await expect(panel(page).getByRole("heading", { name: "Stems you can export (3)" })).toBeVisible();

    const vocals = entries.locator('[data-stem-id="stem-track-neon-drift-vocals"]');
    await expect(vocals.getByText("Neon Drift: Vocals")).toBeVisible();
    await expect(vocals.getByText("Aya Volt · Remix license")).toBeVisible();
    await expect(vocals.getByText("122 BPM · Am (8A) · cue at 0.214 s")).toBeVisible();
    await expect(vocals.getByText("Aya Volt - Neon Drift (Vocals).mp3")).toBeVisible();

    // Measured facts are never guessed.
    const bass = entries.locator('[data-stem-id="stem-track-glass-harbour-bass"]');
    await expect(bass.getByText("124 BPM · Key not measured · no cue")).toBeVisible();

    const skipped = panel(page).getByRole("list", { name: "Lines left out of the export" });
    await expect(panel(page).getByRole("heading", { name: "Left out (4)" })).toBeVisible();
    await expect(skipped.locator('[data-track-id="track-midnight-courier"]')).toContainText(
      "no standard terms",
    );
    await expect(skipped.locator('[data-track-id="track-saltwater"]')).toContainText(
      "You do not own a stem of this track yet.",
    );
  });

  test("downloads each stem one after another under its file name, with the licensed download path", async ({
    authenticatedPage: page,
  }) => {
    const { stemDownloads } = await openSavedCrate(page);
    const names: string[] = [];
    page.on("download", (download) => names.push(download.suggestedFilename()));

    await panel(page).getByRole("button", { name: "Download stems" }).click();
    await expect(page.getByText("Stems downloaded")).toBeVisible();
    await expect.poll(() => names.length).toBe(3);

    expect(names).toEqual([
      "Aya Volt - Neon Drift (Vocals).mp3",
      "Aya Volt - Neon Drift (Drums).mp3",
      "Mira Okoye - Glass Harbour (Bass).mp3",
    ]);
    expect(stemDownloads).toEqual([
      { stemId: "stem-track-neon-drift-vocals", walletAddress: MOCK_BUYER },
      { stemId: "stem-track-neon-drift-drums", walletAddress: MOCK_BUYER },
      { stemId: "stem-track-glass-harbour-bass", walletAddress: MOCK_BUYER },
    ]);
    await expect(panel(page).getByText(/^Saved 3 stems\./)).toBeVisible();
  });

  test("the folder is remembered in this browser, checked before export, and sent with the export request", async ({
    authenticatedPage: page,
  }) => {
    const { exportRequests } = await openSavedCrate(page);
    const rekordbox = panel(page).getByRole("button", { name: "rekordbox XML" });
    const serato = panel(page).getByRole("button", { name: "Serato crate" });
    const folder = panel(page).getByLabel("Folder where you saved these files");

    await expect(rekordbox).toBeDisabled();
    await expect(serato).toBeDisabled();

    // A relative path is explained and nothing can be sent.
    await folder.fill("Music/Resonate");
    await expect(panel(page).getByText("Type the full path, starting with / or a drive letter")).toBeVisible();
    await expect(rekordbox).toBeDisabled();

    await folder.fill(FOLDER);
    await expect(rekordbox).toBeEnabled();
    const consoleText: string[] = [];
    page.on("console", (message) => consoleText.push(message.text()));

    const rekordboxDownload = page.waitForEvent("download");
    await rekordbox.click();
    expect((await rekordboxDownload).suggestedFilename()).toBe("Friday warm-up.xml");
    const seratoDownload = page.waitForEvent("download");
    await serato.click();
    expect((await seratoDownload).suggestedFilename()).toBe("Friday warm-up.crate");

    expect(exportRequests).toEqual([
      { crateId: SAVED_ID, format: "rekordbox", folder: FOLDER, urlHasQuery: false },
      { crateId: SAVED_ID, format: "serato", folder: FOLDER, urlHasQuery: false },
    ]);
    // The folder can hold a username: it is never written to the console.
    expect(consoleText.filter((text) => text.includes("dj/Music"))).toEqual([]);

    // Reopening the page in the same browser restores it.
    await page.reload();
    await expect(panel(page).getByLabel("Folder where you saved these files")).toHaveValue(FOLDER);
    await expect(panel(page).getByRole("button", { name: "rekordbox XML" })).toBeEnabled();
  });

  test("a Windows folder is accepted and the page says where each file goes", async ({
    authenticatedPage: page,
  }) => {
    const { exportRequests } = await openSavedCrate(page);
    await panel(page).getByLabel("Folder where you saved these files").fill("C:\\Users\\dj\\My Music");
    await expect(panel(page).getByRole("button", { name: "rekordbox XML" })).toBeEnabled();
    await expect(panel(page).getByText(/File > Import > rekordbox xml/)).toBeVisible();
    await expect(panel(page).getByText(/_Serato_\/Subcrates/)).toBeVisible();
    await expect(panel(page).getByText(/Serato works out tempo, key and cues from its own analysis/)).toBeVisible();
    await expect(panel(page).getByText(/It stays in this browser; Resonate does not keep it\./)).toBeVisible();
    expect(exportRequests).toEqual([]);
  });

  test("a failed export says why in plain words", async ({ authenticatedPage: page }) => {
    const { failExport, exportRequests } = await openSavedCrate(page);
    failExport({
      status: 409,
      json: { code: "nothing_to_export", message: "No stem in this crate is owned under a license that includes export" },
    });
    await panel(page).getByLabel("Folder where you saved these files").fill(FOLDER);
    await panel(page).getByRole("button", { name: "Serato crate" }).click();
    await expect(page.getByText("Could not export the Serato crate")).toBeVisible();
    await expect(page.getByText(/None of the stems in this crate are ones you own/)).toBeVisible();
    expect(exportRequests).toHaveLength(1);
  });

  test("a crate with nothing owned says so and lists what was left out", async ({
    authenticatedPage: page,
  }) => {
    await openSavedCrate(page, { ownsNothing: true });
    await expect(panel(page).getByTestId("crate-export-empty")).toContainText("Nothing to export yet");
    await expect(panel(page).getByRole("button", { name: "Download stems" })).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: "rekordbox XML" })).toHaveCount(0);
    await expect(panel(page).getByRole("heading", { name: "Left out (6)" })).toBeVisible();
  });

  test("the export panel has no serious automated accessibility violations", async ({
    authenticatedPage: page,
  }) => {
    await openSavedCrate(page);
    await expect(panel(page).getByRole("heading", { name: "Stems you can export (3)" })).toBeVisible();
    await panel(page).getByLabel("Folder where you saved these files").fill("Music/Resonate");
    const blocking = async () => {
      const results = await new AxeBuilder({ page })
        .include(".crates-export-panel")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      return results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.html) }));
    };
    expect(await blocking()).toEqual([]);
    await panel(page).getByLabel("Folder where you saved these files").fill(FOLDER);
    expect(await blocking()).toEqual([]);
  });
});

test.describe("Crate watching (#1967)", () => {
  const SAVED_ID = "e2e-watch";
  const NOW = Date.UTC(2026, 8, 28, 9, 0, 0);

  const panel = (page: import("@playwright/test").Page) =>
    page.getByRole("region", { name: "Watch for new releases" });

  async function open(
    page: import("@playwright/test").Page,
    overrides: Record<string, unknown> = {},
    id = SAVED_ID,
  ) {
    const crate = mockCrate(id, { title: "Friday warm-up", status: "saved", ...overrides });
    const mock = await mockCrateApi(page, { savedCrates: [crate], now: NOW });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/crates/${id}`);
    await expect(page.getByRole("heading", { name: "Friday warm-up", level: 1 })).toBeVisible();
    return mock;
  }

  test("turns watching on with a length, shows the expiry, and stops it in one click", async ({
    authenticatedPage: page,
  }) => {
    const { patches } = await open(page);
    await expect(panel(page).getByTestId("crate-watch-status")).toHaveText("Not watching");
    await expect(panel(page).getByText("No new matches this month yet")).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Stop watching" })).toHaveCount(0);

    await panel(page).getByLabel("Watch for").selectOption("30");
    await panel(page).getByLabel("Notify me").click();
    await expect(panel(page).getByTestId("crate-watch-status")).toHaveText("Watching until Oct 28, 2026");
    // Only the watch is sent: no title, no lines.
    expect(patches).toEqual([
      { crateId: SAVED_ID, body: { watch: { mode: "notify", expiresInDays: 30 } } },
    ]);

    await panel(page).getByRole("button", { name: "Stop watching" }).click();
    await expect(panel(page).getByTestId("crate-watch-status")).toHaveText("Not watching");
    expect(patches[1]).toEqual({ crateId: SAVED_ID, body: { watch: { mode: "off" } } });
    await expect(panel(page).getByRole("button", { name: "Stop watching" })).toHaveCount(0);
  });

  test("shows the month's summary and the recent matches with links to the release", async ({
    authenticatedPage: page,
  }) => {
    await open(page, { watch: watchingWatch() });
    await expect(panel(page).getByTestId("crate-watch-status")).toHaveText("Watching until Dec 27, 2026");
    await expect(panel(page).getByText("3 new matches this month")).toBeVisible();
    const matches = panel(page).getByTestId("crate-watch-match");
    await expect(matches).toHaveCount(3);
    await expect(matches.first().getByRole("link", { name: "Harbour Lights by Aya Volt" })).toHaveAttribute(
      "href",
      "/release/release-new-1",
    );
    await expect(matches.nth(2)).toContainText("Paper Moons");
  });

  test("a draft crate asks to be saved first, and watching starts after saving", async ({
    authenticatedPage: page,
  }) => {
    await open(page, { status: "draft" }, "e2e-watch-draft");
    await expect(panel(page).getByTestId("crate-watch-draft")).toHaveText("Save the crate to watch it.");
    await expect(panel(page).getByLabel("Notify me")).toHaveCount(0);

    await page.getByRole("button", { name: "Save crate" }).click();
    await expect(page.getByText("Crate saved")).toBeVisible();
    await expect(panel(page).getByLabel("Notify me")).toBeVisible();
    await expect(panel(page).getByTestId("crate-watch-draft")).toHaveCount(0);
  });

  test("shows a plain Crate Pro note instead of the control when the entitlement denies", async ({
    authenticatedPage: page,
  }) => {
    await open(page, {
      entitlements: {
        pro: { allowed: true, reason: "free_for_everyone", policyVersion: "v1" },
        export: { allowed: true, reason: "free_for_everyone", policyVersion: "v1" },
        watch: WATCH_DENIED,
      },
    });
    await expect(panel(page).getByTestId("crate-watch-denied")).toHaveText(
      "Watching a crate is part of Crate Pro.",
    );
    await expect(panel(page).getByLabel("Notify me")).toHaveCount(0);
    // Everything else on the page still works: the crate and its lines stay.
    await expect(page.locator(".crates-line").first()).toBeVisible();
  });

  test("a watching crate can always be stopped, even when the entitlement now denies", async ({
    authenticatedPage: page,
  }) => {
    const { patches } = await open(page, {
      watch: watchingWatch(),
      entitlements: {
        pro: { allowed: false, reason: "subscription_required", policyVersion: "v2" },
        export: { allowed: false, reason: "subscription_required", policyVersion: "v2" },
        watch: WATCH_DENIED,
      },
    });
    await panel(page).getByRole("button", { name: "Stop watching" }).click();
    await expect(panel(page).getByTestId("crate-watch-status")).toHaveText("Not watching");
    expect(patches[0].body).toEqual({ watch: { mode: "off" } });
  });

  test("the watch panel has no serious automated accessibility violations", async ({
    authenticatedPage: page,
  }) => {
    await open(page, { watch: watchingWatch() });
    const blocking = async () => {
      const results = await new AxeBuilder({ page })
        .include(".crates-watch-panel")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      return results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.html) }));
    };
    expect(await blocking()).toEqual([]);
    await panel(page).getByRole("button", { name: "Stop watching" }).click();
    await expect(panel(page).getByTestId("crate-watch-status")).toHaveText("Not watching");
    expect(await blocking()).toEqual([]);
  });
});
