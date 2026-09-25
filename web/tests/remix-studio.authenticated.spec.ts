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
  return { patches };
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
    await expect(page.getByRole("button", { name: "Original" })).toBeVisible();

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
});
