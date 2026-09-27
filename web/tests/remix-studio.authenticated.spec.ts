import { test, expect } from "./auth.setup";
import { PROJECT_ID, mockRemixApi } from "./fixtures/remix-studio-mock.mjs";

/**
 * Remix Studio session view (#1879): lanes, transport, and autosave against a
 * fully mocked remix API — no backend data needed. Stem previews are small
 * generated WAV tones so the real WebAudio engine decodes and plays them. The
 * mock is shared with the User Guide screenshot capture (#1905).
 */

// Headless Chromium must start the AudioContext without a user gesture.
test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

test.describe("Remix Studio session view (#1879)", () => {
  test("lanes, transport, and autosave work together", async ({
    authenticatedPage: page,
  }) => {
    const { patches } = await mockRemixApi(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/remix/studio/${PROJECT_ID}`);

    await expect(page.getByRole("heading", { name: "Session" })).toBeVisible();
    // One project-level musical summary; the drums "key" never outvotes.
    await expect(page.getByText("120 BPM · C minor")).toBeVisible();

    // The muted full mix is a reference source, not a lane.
    await expect(page.getByRole("button", { name: "Mute Vocals" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mute Original" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Original", exact: true })).toBeVisible();

    // Drag-free edit: switch the drums off for section 2 → autosaved.
    await page.getByRole("button", { name: "Drums: section 2 on" }).click();
    await expect(page.getByRole("button", { name: "Drums: section 2 off" })).toBeVisible();
    await expect.poll(() => patches.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(patches.at(-1)).toMatchObject({
      stems: [
        {
          stemId: "stem-drums",
          arrangement: { sections: [true, false, true, true] },
        },
      ],
    });
    await expect(page.getByText("All changes saved")).toBeVisible();
    // No Save button any more — autosave owns persistence.
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

    // Transport: play the live arrangement through the real WebAudio engine.
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("meter", { name: "Preview output level" })).toBeVisible();

    // Loop section 3, then clear it.
    await page.getByRole("button", { name: /Loop section 3/ }).click();
    await expect(page.getByText(/Looping bar 17/)).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("remix-studio-session.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Clear loop" }).click();
    await expect(page.getByText(/Looping bar/)).toHaveCount(0);

    // Space stops playback when focus is not in a text field or button.
    await page.getByRole("heading", { name: "Session" }).click();
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  });

  test("create panel recipes and drafts panel (#1879 phase 2)", async ({
    authenticatedPage: page,
  }) => {
    const { patches } = await mockRemixApi(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/remix/studio/${PROJECT_ID}`);

    const create = page.getByRole("group", { name: "What to create" });
    await expect(create.getByRole("button", { name: "Mix stems" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Render mix" })).toBeVisible();
    // No draft yet: the drafts panel says so, and never shows internal ids.
    const drafts = page.getByRole("region", { name: "Drafts" });
    await expect(drafts).toBeVisible();
    await expect(page.getByText(/policy/i)).toHaveCount(0);

    // One-click arrangement: Instrumental mutes the vocals → autosaved.
    await page.getByRole("button", { name: "Instrumental" }).click();
    await expect(page.getByRole("button", { name: "Mute Vocals" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect
      .poll(
        () =>
          patches.some((patch) =>
            (patch.stems as Array<{ stemId: string; muted?: boolean }> | undefined)?.some(
              (stem) => stem.stemId === "stem-vocals" && stem.muted === true,
            ),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);

    // Add AI opens on "Add a part" (#1901); the whole-track intents sit
    // under "Experimental", where picking one saves it.
    await create.getByRole("button", { name: "Add AI" }).click();
    await expect(page.getByRole("radiogroup", { name: "Instrument" })).toBeVisible();
    await page
      .getByRole("button", { name: "Experimental: change the whole track" })
      .click();
    const reimagine = page
      .getByRole("radiogroup", { name: "AI intent" })
      .getByRole("radio", { name: /Reimagine the track/ });
    await expect(reimagine).not.toBeChecked();
    await page
      .getByRole("radiogroup", { name: "AI intent" })
      .getByText("Reimagine the track")
      .click();
    await expect(reimagine).toBeChecked();
    await expect(page.getByText(/\$0\.10 per 30 s/)).toBeVisible();
    // The intent survives its own autosave round-trip (mode → variation).
    await expect
      .poll(() => patches.some((patch) => patch.mode === "variation"), {
        timeout: 10_000,
      })
      .toBe(true);
    await expect(page.getByText("All changes saved")).toBeVisible();
    await expect(create.getByRole("button", { name: "Add AI" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.mouse.move(5, 5);
    await page.screenshot({
      path: test.info().outputPath("remix-studio-create.png"),
      fullPage: true,
    });
  });

  test("drafts stay above the fold next to a tall Create panel", async ({
    authenticatedPage: page,
  }) => {
    // Staging report: zero credits + a completed AI draft + variation mode
    // pushed Drafts below the fold in the old right column.
    await mockRemixApi(page, {
      balanceCents: 0,
      project: {
        mode: "variation",
        prompt: "An intimate acoustic rework with organic percussion.",
        generationJobId: "job-current",
        generationProvider: "stem-plus-ai-layered-render",
        generationMetadata: {
          status: "completed",
          grounding: "stem_plus_ai",
          estimatedCostUsd: 0.06,
          completedAt: "2026-09-20T13:36:00.000Z",
          output: { outputUri: "/storage/remix-drafts/job-current.mp3" },
          previousDrafts: [
            {
              jobId: "job-older",
              provider: "stem-mix-render",
              grounding: "stem_audio",
              estimatedCostUsd: 0,
              completedAt: "2026-09-19T10:00:00.000Z",
              outputUri: "/storage/remix-drafts/job-older.mp3",
            },
          ],
        },
      },
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/remix/studio/${PROJECT_ID}`);

    const drafts = page.getByRole("region", { name: "Drafts" });
    await expect(drafts).toBeVisible();
    // Drafts sits directly under the Session (no dead column space) …
    const session = page.locator("section", {
      has: page.getByRole("heading", { name: "Session" }),
    });
    const sessionBox = await session.first().boundingBox();
    const draftsBox = await drafts.boundingBox();
    expect(sessionBox && draftsBox).toBeTruthy();
    expect(draftsBox!.y - (sessionBox!.y + sessionBox!.height)).toBeLessThan(64);
    expect(Math.abs(draftsBox!.x - sessionBox!.x)).toBeLessThan(4);
    // … the sticky Create column never outgrows the viewport (the panel,
    // taller since "Add a part" sits above the whole-track intents (#1901),
    // scrolls inside it) …
    const createColumn = page.locator(".remix-studio-create-column");
    const createBox = await createColumn.boundingBox();
    expect(createBox!.height).toBeLessThanOrEqual(900);
    await expect(
      createColumn.getByRole("button", { name: "Experimental: change the whole track" }),
    ).toHaveAttribute("aria-expanded", "true");
    // … and Publish is reachable, not stranded under a sticky column.
    const publish = page.getByRole("button", { name: "Publish on Resonate" });
    await publish.scrollIntoViewIfNeeded();
    await expect(publish).toBeInViewport();
    // Out of credits: one honest message, never claiming mixes need credits.
    await expect(page.getByText(/won't render/)).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("remix-studio-drafts-layout.png"),
    });
  });

  test("vibe starters and per-stem FX autosave a remix-fx recipe (#1897)", async ({
    authenticatedPage: page,
  }) => {
    const { patches } = await mockRemixApi(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/remix/studio/${PROJECT_ID}`);

    // One click: Slowed + reverb sets visible master controls.
    const vibes = page.getByRole("group", { name: "Vibe" });
    await vibes.getByRole("button", { name: "Slowed + reverb" }).click();
    await expect(vibes.getByRole("button", { name: "Slowed + reverb" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText("0.85×").first()).toBeVisible();
    await expect
      .poll(
        () =>
          patches.some((patch) => {
            const effects = patch.effects as
              | { master?: { speed?: number; space?: number } }
              | undefined;
            return effects?.master?.speed === 0.85 && effects.master.space === 0.45;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect(page.getByText("All changes saved")).toBeVisible();

    // Per-stem effects: the lane button is spelled out (#1905), not "FX".
    await expect(page.getByRole("button", { name: /^Effects for Vocals/ })).toHaveText("Effects");
    await page.getByRole("button", { name: /^Effects for Vocals/ }).click();
    await expect(page.getByRole("group", { name: "Vocals effects" })).toBeVisible();

    // The effects preview plays through the real WebAudio graph.
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: test.info().outputPath("remix-studio-vibes.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // "No effects" resets the recipe to null.
    await page
      .getByRole("group", { name: "Vibe" })
      .getByRole("button", { name: "No effects", exact: true })
      .click();
    await expect
      .poll(() => patches.some((patch) => "effects" in patch && patch.effects === null), {
        timeout: 10_000,
      })
      .toBe(true);
  });

  test("structure blocks: repeat a section and one-click short edit (#1899)", async ({
    authenticatedPage: page,
  }) => {
    const { patches } = await mockRemixApi(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/remix/studio/${PROJECT_ID}`);
    await expect(page.getByRole("heading", { name: "Session" })).toBeVisible();

    // Repeat the section starting at bar 17 from its options menu.
    await page.getByRole("button", { name: "Section options for bar 17" }).click();
    await page.getByRole("menuitem", { name: /Repeat this section/ }).click();
    await expect
      .poll(
        () =>
          patches.some((patch) => {
            const structure = patch.structure as
              | { blocks?: Array<{ section: number }> }
              | null
              | undefined;
            return (
              JSON.stringify(structure?.blocks?.map((block) => block.section)) ===
              JSON.stringify([0, 1, 2, 2, 3])
            );
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
    // The repeated block shows its repeat mark.
    await expect(page.getByTitle(/Repeat of bar 17/).first()).toBeVisible();

    // One-click Short edit: shorter and fades out.
    await page.getByRole("button", { name: /Short edit/ }).click();
    await expect
      .poll(
        () =>
          patches.some((patch) => {
            const structure = patch.structure as
              | { blocks?: Array<{ section: number; fadeOut?: boolean }> }
              | null
              | undefined;
            const blocks = structure?.blocks ?? [];
            return blocks.length > 0 && blocks.length < 4 && blocks.at(-1)?.fadeOut === true;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect(page.getByText("All changes saved")).toBeVisible();

    // The restructured timeline plays through the preview engine.
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: test.info().outputPath("remix-studio-structure.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // Original length restores the original order (structure null).
    await page.getByRole("button", { name: /Original length/ }).click();
    await expect
      .poll(() => patches.some((patch) => "structure" in patch && patch.structure === null), {
        timeout: 10_000,
      })
      .toBe(true);
  });

  test("describe it: plain words preview a diff, apply autosaves, undo restores (#1900)", async ({
    authenticatedPage: page,
  }) => {
    const { patches } = await mockRemixApi(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/remix/studio/${PROJECT_ID}`);

    await page
      .getByLabel("Describe the remix you want")
      .fill("slower and dreamy, no drums");
    await page.getByRole("button", { name: "Preview changes" }).click();
    // A visible diff first — nothing changes until Apply.
    await expect(page.getByText("0.85×").first()).toBeVisible();
    await expect(page.getByText(/muted/).first()).toBeVisible();
    const patchesBeforeApply = patches.length;
    await page.screenshot({
      path: test.info().outputPath("remix-studio-describe.png"),
      fullPage: true,
    });
    expect(patches.length).toBe(patchesBeforeApply);

    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByText("Applied — adjust anything below.")).toBeVisible();
    await expect
      .poll(
        () =>
          patches.some((patch) => {
            const effects = patch.effects as { master?: { speed?: number } } | undefined;
            const stems = patch.stems as Array<{ stemId: string; muted?: boolean }> | undefined;
            return (
              effects?.master?.speed === 0.85 &&
              !!stems?.some((stem) => stem.stemId === "stem-drums" && stem.muted === true)
            );
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect(page.getByText("All changes saved")).toBeVisible();

    // Undo survives the autosave round-trip and restores the previous state.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(
        () =>
          patches.some((patch) => {
            const stems = patch.stems as Array<{ stemId: string; muted?: boolean }> | undefined;
            return (
              "effects" in patch &&
              patch.effects === null &&
              !!stems?.some((stem) => stem.stemId === "stem-drums" && stem.muted === false)
            );
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  test("beat maker: add a preset beat, edit a step, play, remove (#1902)", async ({
    authenticatedPage: page,
  }) => {
    const { patches } = await mockRemixApi(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/remix/studio/${PROJECT_ID}`);
    await expect(page.getByRole("heading", { name: "Session" })).toBeVisible();

    type BeatPatch = {
      kit?: string;
      pattern?: Record<string, boolean[]>;
    } | null;
    const beatOf = (patch: Record<string, unknown>) => patch.beat as BeatPatch | undefined;

    // One click adds a beat that locks to the song's tempo.
    await page.getByRole("button", { name: /Four on the floor/ }).first().click();
    await expect
      .poll(
        () =>
          patches.some((patch) => {
            const beat = beatOf(patch);
            return !!beat && beat.pattern?.kick?.[0] === true && beat.pattern?.kick?.[4] === true;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
    // The Beat lane joins the session.
    await expect(page.getByRole("button", { name: "Mute Beat" })).toBeVisible();

    // Edit the pattern: add a snare on step 5.
    await page.getByRole("button", { name: "Snare step 5" }).click();
    await expect
      .poll(
        () => patches.some((patch) => beatOf(patch)?.pattern?.snare?.[4] === true),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect(page.getByText("All changes saved")).toBeVisible();

    // The beat plays with the stems through the preview engine.
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: test.info().outputPath("remix-studio-beat.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // Remove beat clears the recipe.
    await page.getByRole("button", { name: "Remove beat" }).click();
    await expect
      .poll(() => patches.some((patch) => "beat" in patch && patch.beat === null), {
        timeout: 10_000,
      })
      .toBe(true);
  });

  test("tempo & key: keep original pitch and a key change, prepared in workers (#1898)", async ({
    authenticatedPage: page,
  }) => {
    const { patches } = await mockRemixApi(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/remix/studio/${PROJECT_ID}`);
    await expect(page.getByRole("heading", { name: "Session" })).toBeVisible();

    type PitchPatch = {
      schemaVersion?: string;
      master?: { keepPitch?: boolean; semitones?: number; warmth?: number };
    } | null;
    const effectsOf = (patch: Record<string, unknown>) =>
      patch.effects as PitchPatch | undefined;

    // Keep original pitch is a labelled switch, available at any speed.
    const keep = page.getByRole("switch", { name: "Keep original pitch" });
    await expect(keep).toHaveAttribute("aria-checked", "false");
    await keep.click();
    await expect(keep).toHaveAttribute("aria-checked", "true");

    // Key +2 with the stepper.
    const key = page.getByRole("group", { name: "Key", exact: true });
    await expect(key.getByText("Original key")).toBeVisible();
    await key.getByRole("button", { name: "Raise the key" }).click();
    await key.getByRole("button", { name: "Raise the key" }).click();
    await expect(key.getByText("+2 (higher)")).toBeVisible();

    // The preview prepares the key change in the stretch workers (real WASM).
    const preparing = page.getByText(/Preparing tempo & key for the preview/);
    await expect(preparing).toBeVisible();
    const started = Date.now();
    await expect(preparing).toHaveCount(0, { timeout: 90_000 });
    test.info().annotations.push({
      type: "stretch-prepare-ms",
      description: String(Date.now() - started),
    });
    await expect(page.getByText(/couldn't apply the tempo & key change/)).toHaveCount(0);

    await expect
      .poll(
        () =>
          patches.some((patch) => {
            const effects = effectsOf(patch);
            return (
              effects?.schemaVersion === "remix-fx/v3" &&
              effects.master?.keepPitch === true &&
              effects.master?.semitones === 2
            );
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect(page.getByText("All changes saved")).toBeVisible();

    // The shifted arrangement plays through the preview engine.
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: test.info().outputPath("remix-studio-tempo-key.png"),
      fullPage: true,
    });
    // A/B compare while playing: Original (untouched, no effects) and back.
    const original = page.getByRole("button", { name: "Original", exact: true });
    const arrangement = page.getByRole("button", { name: "Arrangement", exact: true });
    await original.click();
    await expect(original).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await arrangement.click();
    await expect(arrangement).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(keep).toBeEnabled();
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // A vibe changes the sound but keeps both choices (and slows the tempo,
    // which the workers prepare again).
    await page
      .getByRole("group", { name: "Vibe" })
      .getByRole("button", { name: "Lo-fi" })
      .click();
    await expect
      .poll(
        () =>
          patches.some((patch) => {
            const effects = effectsOf(patch);
            return (
              effects?.master?.warmth === 0.5 &&
              effects.master.keepPitch === true &&
              effects.master.semitones === 2
            );
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect(keep).toHaveAttribute("aria-checked", "true");
    await expect(key.getByText("+2 (higher)")).toBeVisible();
    await expect(preparing).toHaveCount(0, { timeout: 90_000 });
    await expect(page.getByText(/couldn't apply the tempo & key change/)).toHaveCount(0);

    // Reset to original clears them with everything else.
    await page.getByRole("button", { name: /Reset to original/ }).click();
    await page.getByRole("button", { name: /^Reset/ }).last().click();
    await expect
      .poll(() => patches.some((patch) => "effects" in patch && patch.effects === null), {
        timeout: 10_000,
      })
      .toBe(true);
    await expect(keep).toHaveAttribute("aria-checked", "false");
    await expect(key.getByText("Original key")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("pro mode: per-stem EQ and pan autosave a remix-fx/v3 recipe; a badge shows them with Pro off (#1903)", async ({
    authenticatedPage: page,
  }) => {
    const { patches } = await mockRemixApi(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/remix/studio/${PROJECT_ID}`);
    await expect(page.getByRole("heading", { name: "Session" })).toBeVisible();
    const badge = page.getByTitle("Pro EQ/pan active — turn on Pro to edit");
    await expect(badge).toHaveCount(0);

    // The Pro switch is off by default and offered by the server.
    const pro = page.getByRole("switch", { name: /^Pro/ });
    await expect(pro).toHaveAttribute("aria-checked", "false");
    await pro.click();
    await expect(pro).toHaveAttribute("aria-checked", "true");

    // Bass: EQ Low +3 dB and pan L 30 in the FX row's Pro strip.
    await page.getByRole("button", { name: /^Effects for Bass/ }).click();
    const strip = page.getByRole("group", { name: "Bass Pro channel strip" });
    await expect(strip).toBeVisible();
    const low = strip.getByRole("slider", { name: "Bass EQ Low 200 Hz" });
    const pan = strip.getByRole("slider", { name: "Bass pan" });
    await low.fill("3");
    await pan.fill("-0.3");
    await expect(low).toHaveAttribute("aria-valuetext", "+3 dB");
    await expect(pan).toHaveAttribute("aria-valuetext", "L 30");
    await expect
      .poll(
        () =>
          patches.some((patch) => {
            const effects = patch.effects as
              | {
                  schemaVersion?: string;
                  stems?: Record<string, { eqLow?: number; pan?: number }>;
                }
              | null
              | undefined;
            return (
              effects?.schemaVersion === "remix-fx/v3" &&
              effects.stems?.["stem-bass"]?.eqLow === 3 &&
              effects.stems?.["stem-bass"]?.pan === -0.3
            );
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect(page.getByText("All changes saved")).toBeVisible();

    // The Pro nodes play through the real WebAudio preview.
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: test.info().outputPath("remix-studio-pro.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // Pro off: the settings stay, flagged by a badge on the Bass lane.
    await pro.click();
    await expect(pro).toHaveAttribute("aria-checked", "false");
    await expect(strip).toHaveCount(0);
    await expect(badge).toHaveCount(1);
    await expect(badge).toBeVisible();

    // The switch is remembered on this device; the badge survives a reload.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Session" })).toBeVisible();
    await expect(page.getByRole("switch", { name: /^Pro/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(badge).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("studio polish: listening volume, reset to original, delete a draft version (#1910)", async ({
    authenticatedPage: page,
  }) => {
    const completedDraft = {
      status: "completed",
      grounding: "stem_audio",
      completedAt: "2026-09-20T13:36:00.000Z",
      output: { outputUri: "/storage/remix-drafts/job-current.mp3" },
      previousDrafts: [
        {
          jobId: "job-older",
          provider: "stem-mix-render",
          grounding: "stem_audio",
          estimatedCostUsd: 0,
          completedAt: "2026-09-19T10:00:00.000Z",
          outputUri: "/storage/remix-drafts/job-older.mp3",
        },
      ],
    };
    const { patches, deletes } = await mockRemixApi(page, {
      project: {
        generationJobId: "job-current",
        generationProvider: "stem-mix-render",
        generationMetadata: completedDraft,
      },
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/remix/studio/${PROJECT_ID}`);
    await expect(page.getByRole("heading", { name: "Session" })).toBeVisible();

    // 1. Listening volume lives in the transport (this device only).
    await expect(page.getByRole("slider", { name: /Volume/ })).toBeVisible();

    // 2. Reset to original: change something, then reset with confirmation.
    await page
      .getByRole("group", { name: "Vibe" })
      .getByRole("button", { name: "Lo-fi" })
      .click();
    await expect
      .poll(() => patches.some((patch) => (patch.effects as { master?: { warmth?: number } } | null)?.master?.warmth === 0.5), {
        timeout: 10_000,
      })
      .toBe(true);
    await page.getByRole("button", { name: /Reset to original/ }).click();
    await expect(page.getByText(/Your drafts are kept/)).toBeVisible();
    await page.getByRole("button", { name: /^Reset/ }).last().click();
    await expect
      .poll(() => patches.some((patch) => "effects" in patch && patch.effects === null), {
        timeout: 10_000,
      })
      .toBe(true);

    // 3. Delete a previous draft version (confirmed).
    await page.getByRole("button", { name: /^Delete version from/ }).click();
    await expect(page.getByText(/can't be undone/)).toBeVisible();
    await page.getByRole("button", { name: /^Delete/ }).last().click();
    await expect.poll(() => deletes).toEqual(["job-older"]);
    await expect(page.getByRole("button", { name: /^Delete version from/ })).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("remix-studio-polish.png"),
      fullPage: true,
    });
  });

  test("add an AI part: generate 3 takes, audition, use one, edit its lane, remove (#1901)", async ({
    authenticatedPage: page,
  }) => {
    const { patches, partGenerates } = await mockRemixApi(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/remix/studio/${PROJECT_ID}`);
    await expect(page.getByRole("heading", { name: "Session" })).toBeVisible();

    type PartsPatch = {
      parts?: Array<{ id: string; role: string; takeId: string; blocks?: boolean[] }>;
    } | null;
    const partsOf = (patch: Record<string, unknown>) => patch.parts as PartsPatch | undefined;

    // Add AI opens on "Add a part": pick Bass, 4 bars, see the price first.
    await page
      .getByRole("group", { name: "What to create" })
      .getByRole("button", { name: "Add AI" })
      .click();
    const instruments = page.getByRole("radiogroup", { name: "Instrument" });
    await instruments.getByText("Bass", { exact: true }).click();
    await expect(instruments.getByRole("radio", { name: "Bass" })).toBeChecked();
    await expect(
      page.getByRole("radiogroup", { name: "Length" }).getByRole("radio", { name: "4 bars" }),
    ).toBeChecked();
    await expect(page.getByText("3 takes · 30¢ · you have $5.00")).toBeVisible();
    // Switching sides never changed the saved (free) mix mode.
    expect(patches.some((patch) => "mode" in patch)).toBe(false);

    await page.getByRole("button", { name: "Generate 3 takes" }).click();
    await expect.poll(() => partGenerates).toEqual([
      { role: "bass", bars: 4, style: null, takes: 3 },
    ]);
    // The tray fills in as the takes finish.
    const tray = page.locator(".remix-parts-tray");
    await expect(tray.getByRole("heading", { name: "Bass takes" })).toBeVisible();
    await expect(tray.locator(".remix-parts-take-ready")).toHaveCount(3, { timeout: 15_000 });
    await expect(tray.getByText("3 takes ready.")).toBeVisible();

    // Audition Take 2 over the arrangement.
    const take2 = tray.locator(".remix-parts-take").nth(1);
    await expect(take2.getByText("Take 2")).toBeVisible();
    await take2.getByRole("button", { name: "Audition" }).click();
    await expect(page.getByText("Auditioning Take 2 · AI Bass")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(take2.getByRole("button", { name: "Stop audition" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Use it: an AI Bass lane joins the session, autosaved.
    await take2.getByRole("button", { name: "Use this take" }).click();
    await expect(page.getByRole("button", { name: "Mute AI Bass" })).toBeVisible();
    await expect(page.getByText("Auditioning Take 2 · AI Bass")).toHaveCount(0);
    await expect
      .poll(
        () =>
          patches.some((patch) => {
            const parts = partsOf(patch);
            return !!parts?.parts?.some(
              (part) => part.role === "bass" && part.takeId === "take-1-2",
            );
          }),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect(take2.getByRole("button", { name: "In use" })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("remix-studio-ai-part.png"),
      fullPage: true,
    });

    // Turn the part off on section 2.
    await page.getByRole("button", { name: "AI Bass: section 2 on" }).click();
    await expect
      .poll(
        () =>
          patches.some((patch) => partsOf(patch)?.parts?.[0]?.blocks?.[1] === false),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect(page.getByText("All changes saved")).toBeVisible();

    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // Remove the lane (confirmed): the recipe is cleared.
    await page.getByRole("button", { name: "Remove AI Bass" }).click();
    await page.getByRole("button", { name: "Remove lane" }).click();
    await expect
      .poll(() => patches.some((patch) => "parts" in patch && patch.parts === null), {
        timeout: 10_000,
      })
      .toBe(true);
    await expect(page.getByRole("button", { name: "Mute AI Bass" })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
