import type { Page } from "@playwright/test";
import { test, expect } from "./auth.setup";

/**
 * Remix Studio session view (#1879): lanes, transport, and autosave against a
 * fully mocked remix API — no backend data needed. Stem previews are small
 * generated WAV tones so the real WebAudio engine decodes and plays them.
 */

const PROJECT_ID = "e2e-remix-project";
const SECTION_SECONDS = 16;
const DURATION_SECONDS = 64;

// Headless Chromium must start the AudioContext without a user gesture.
test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

type MockStem = {
  stemId: string;
  type: string;
  title: string | null;
  role: string | null;
  gainDb: number | null;
  muted: boolean;
  arrangement: unknown;
  audioFeatures: Record<string, unknown> | null;
};

function features(key: { tonic: string; mode: string } | null) {
  return {
    schemaVersion: "stem-audio-features/v1",
    tempoBpm: 120,
    tempoConfidence: 0.8,
    firstBeatSec: 0,
    key: key ? { ...key, confidence: 0.7 } : null,
    durationSeconds: DURATION_SECONDS,
  };
}

function mockProject(stems: MockStem[]) {
  return {
    id: PROJECT_ID,
    creatorUserId: "test-user",
    sourceTrackId: "e2e-track",
    title: "Neon Drift (Remix)",
    status: "draft",
    mode: "stem_mix",
    licenseType: "remix",
    licenseId: null,
    prompt: null,
    generationProvider: null,
    generationJobId: null,
    generationMetadata: null,
    attribution: null,
    exportPolicy: null,
    policyVersion: "2026-07-03.v6",
    publishedReleaseId: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    source: {
      trackId: "e2e-track",
      trackTitle: "Neon Drift",
      releaseId: "e2e-release",
      releaseTitle: "Night Signals",
      artistName: "Aya Volt",
      rightsRoute: "TRUSTED_FAST_PATH",
      contentStatus: "clean",
    },
    stems,
    availableStems: [],
    sectionGrid: {
      kind: "bars",
      sections: [0, 1, 2, 3].map((index) => ({
        startSec: index * SECTION_SECONDS,
        endSec: (index + 1) * SECTION_SECONDS,
      })),
      sectionSeconds: SECTION_SECONDS,
      durationSeconds: DURATION_SECONDS,
      bpm: 120,
    },
  };
}

/** Mono 16-bit PCM sine tone, small enough to serve per stem. */
function toneWav(frequency: number, seconds = DURATION_SECONDS): Buffer {
  const sampleRate = 8000;
  const frames = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i += 1) {
    // A slow amplitude swell so the waveform lanes have visible shape.
    const swell = 0.35 + 0.3 * Math.sin((2 * Math.PI * i) / (sampleRate * 8));
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * swell;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return buffer;
}

async function mockRemixApi(
  page: Page,
  options: {
    balanceCents?: number;
    project?: Record<string, unknown>;
  } = {},
) {
  let stems: MockStem[] = [
    {
      stemId: "stem-original",
      type: "original",
      title: null,
      role: null,
      gainDb: null,
      muted: true,
      arrangement: null,
      audioFeatures: features({ tonic: "C", mode: "minor" }),
    },
    {
      stemId: "stem-vocals",
      type: "vocals",
      title: null,
      role: null,
      gainDb: null,
      muted: false,
      arrangement: null,
      audioFeatures: features({ tonic: "C", mode: "minor" }),
    },
    {
      stemId: "stem-drums",
      type: "drums",
      title: null,
      role: null,
      gainDb: -2,
      muted: false,
      arrangement: null,
      audioFeatures: features({ tonic: "A#", mode: "minor" }),
    },
    {
      stemId: "stem-bass",
      type: "bass",
      title: null,
      role: null,
      gainDb: null,
      muted: false,
      arrangement: null,
      audioFeatures: features({ tonic: "C", mode: "minor" }),
    },
  ];
  const patches: Array<Record<string, unknown>> = [];
  // Top-level fields the studio autosaves (mode, prompt, title), persisted
  // like the real PATCH so the echoed project matches the saved edits.
  let fields: Record<string, unknown> = { ...(options.project ?? {}) };

  await page.route(`**/remix/projects/${PROJECT_ID}`, async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      const body = request.postDataJSON() as {
        stems?: Array<Partial<MockStem> & { stemId: string }>;
      } & Record<string, unknown>;
      patches.push(body);
      const { stems: stemChanges, ...rest } = body;
      fields = { ...fields, ...rest };
      stems = stems.map((stem) => {
        const change = stemChanges?.find((entry) => entry.stemId === stem.stemId);
        return change ? { ...stem, ...change } : stem;
      });
    }
    await route.fulfill({ json: { ...mockProject(stems), ...fields } });
  });
  await page.route("**/credits/balance", (route) =>
    route.fulfill({
      json: {
        balanceCents: options.balanceCents ?? 500,
        priceCentsPer30s: 10,
        recentTransactions: [],
      },
    }),
  );
  await page.route("**/analytics/product/event", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  const tones: Record<string, number> = {
    "stem-original": 220,
    "stem-vocals": 440,
    "stem-drums": 110,
    "stem-bass": 55,
  };
  await page.route("**/catalog/stems/*/preview", (route) => {
    const stemId = route.request().url().split("/stems/")[1]?.split("/")[0];
    return route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: toneWav(tones[stemId ?? ""] ?? 330),
    });
  });
  await page.route("**/remix/eligibility**", (route) =>
    route.fulfill({
      json: {
        allowed: true,
        requiredLicense: "remix",
        allowedActions: ["draft", "publish_resonate"],
        reasons: [],
        policyVersion: "2026-07-03.v6",
        stems: [],
      },
    }),
  );
  await page.route(`**/remix/projects/${PROJECT_ID}/draft-audio**`, (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: toneWav(330, 32) }),
  );
  const deletes: string[] = [];
  await page.route(`**/remix/projects/${PROJECT_ID}/drafts/*`, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const jobId = route.request().url().split("/drafts/")[1] ?? "";
    deletes.push(jobId);
    const metadata = fields.generationMetadata as
      | { previousDrafts?: Array<{ jobId: string }> }
      | undefined;
    if (metadata?.previousDrafts) {
      fields = {
        ...fields,
        generationMetadata: {
          ...metadata,
          previousDrafts: metadata.previousDrafts.filter((entry) => entry.jobId !== jobId),
        },
      };
    }
    await route.fulfill({ json: { ...mockProject(stems), ...fields } });
  });
  return { patches, deletes };
}

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

    // Add AI shows the flat intents, with "Reimagine the track" selected.
    await create.getByRole("button", { name: "Add AI" }).click();
    await expect(
      page.getByRole("radiogroup", { name: "AI intent" }).getByRole("radio", {
        name: /Reimagine the track/,
      }),
    ).toBeChecked();
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
    // … the sticky Create column never outgrows the viewport …
    const createBox = await page
      .locator("section", { has: page.getByRole("heading", { name: "Create" }) })
      .first()
      .boundingBox();
    expect(createBox!.height).toBeLessThanOrEqual(900);
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

    // Per-stem FX: open the vocals effects row.
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
});
