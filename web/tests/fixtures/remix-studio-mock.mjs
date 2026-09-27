/**
 * A fully mocked Remix Studio API (#1879), shared by the Playwright flows in
 * `tests/remix-studio.authenticated.spec.ts` and the User Guide screenshot
 * capture (`scripts/capture-help-screenshots.mjs`, #1905), so the guide's
 * images and the tested studio can't drift apart. No backend data is needed:
 * stem previews are small generated WAV tones the real WebAudio engine
 * decodes and plays.
 *
 * Plain ESM with JSDoc types so the capture script runs under plain Node.
 */

export const PROJECT_ID = "e2e-remix-project";
export const SECTION_SECONDS = 16;
export const DURATION_SECONDS = 64;

/**
 * @typedef {{
 *   stemId: string;
 *   type: string;
 *   title: string | null;
 *   role: string | null;
 *   gainDb: number | null;
 *   muted: boolean;
 *   arrangement: unknown;
 *   audioFeatures: Record<string, unknown> | null;
 * }} MockStem
 */

/** @param {{ tonic: string; mode: string } | null} key */
export function features(key) {
  return {
    schemaVersion: "stem-audio-features/v1",
    tempoBpm: 120,
    tempoConfidence: 0.8,
    firstBeatSec: 0,
    key: key ? { ...key, confidence: 0.7 } : null,
    durationSeconds: DURATION_SECONDS,
  };
}

/** @param {MockStem[]} stems */
export function mockProject(stems) {
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
    // Pro mode (#1903): free for everyone, decided by the server.
    entitlements: {
      pro: {
        allowed: true,
        reason: "free_for_everyone",
        policyVersion: "remix-pro-policy/v1",
      },
    },
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

/**
 * Mono 16-bit PCM sine tone, small enough to serve per stem.
 * @param {number} frequency
 * @param {number} [seconds]
 * @returns {Buffer}
 */
export function toneWav(frequency, seconds = DURATION_SECONDS) {
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

/** The session's stems: the muted full mix (a reference) plus three parts. */
export function defaultStems() {
  /** @type {MockStem[]} */
  const stems = [
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
  return stems;
}

/** Preview tone per stem id. */
const STEM_TONES = /** @type {Record<string, number>} */ ({
  "stem-original": 220,
  "stem-vocals": 440,
  "stem-drums": 110,
  "stem-bass": 55,
});

/**
 * Routes every studio request the page makes to an in-memory project.
 * Saved edits (PATCH) are applied and echoed back like the real API.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ balanceCents?: number; project?: Record<string, unknown> }} [options]
 */
export async function mockRemixApi(page, options = {}) {
  let stems = defaultStems();
  /** @type {Array<Record<string, unknown>>} */
  const patches = [];
  // AI part takes (#1901): a generate adds pending takes; the next GET of
  // the project finds them completed, like a worker that finished.
  /** @type {Array<Record<string, unknown>>} */
  let partTakes = [];
  let pendingTakes = false;
  /** @type {Array<Record<string, unknown>>} */
  const partGenerates = [];
  /** @type {string[]} */
  const takeDeletes = [];
  // Top-level fields the studio autosaves (mode, prompt, title), persisted
  // like the real PATCH so the echoed project matches the saved edits.
  /** @type {Record<string, unknown>} */
  let fields = { ...(options.project ?? {}) };

  await page.route(`**/remix/projects/${PROJECT_ID}`, async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      /** @type {{ stems?: Array<Partial<MockStem> & { stemId: string }> } & Record<string, unknown>} */
      const body = request.postDataJSON();
      patches.push(body);
      const { stems: stemChanges, ...rest } = body;
      fields = { ...fields, ...rest };
      stems = stems.map((stem) => {
        const change = stemChanges?.find((entry) => entry.stemId === stem.stemId);
        return change ? { ...stem, ...change } : stem;
      });
    }
    if (request.method() === "GET" && pendingTakes) {
      pendingTakes = false;
      partTakes = partTakes.map((take) =>
        take.status === "pending"
          ? {
              ...take,
              status: "completed",
              mimeType: "audio/flac",
              durationSec: 8,
              completedAt: "2026-09-27T12:00:30.000Z",
            }
          : take,
      );
    }
    await route.fulfill({ json: { ...mockProject(stems), ...fields, partTakes } });
  });
  await page.route(`**/remix/projects/${PROJECT_ID}/parts/generate`, async (route) => {
    /** @type {{ role: string; bars: number; style?: string | null; takes?: number }} */
    const body = route.request().postDataJSON();
    partGenerates.push(body);
    const batchId = `batch-${partGenerates.length}`;
    const takes = Array.from({ length: body.takes ?? 3 }, (_, index) => ({
      id: `take-${partGenerates.length}-${index + 1}`,
      batchId,
      role: body.role,
      bars: body.bars,
      style: body.style ?? null,
      seed: index + 1,
      status: "pending",
      promptVersion: "remix-part-prompt/v1",
      provider: null,
      model: null,
      grounding: "feature_conditioned",
      aiGenerated: true,
      costCents: 10,
      mimeType: null,
      durationSec: null,
      conform: null,
      errorCode: null,
      createdAt: `2026-09-27T12:00:0${index}.000Z`,
      startedAt: null,
      completedAt: null,
    }));
    partTakes = [...takes, ...partTakes];
    pendingTakes = true;
    await route.fulfill({
      status: 202,
      json: { batchId, quoteCents: takes.length * 10, perTakeCents: 10, takes },
    });
  });
  // A take is exactly 4 bars at 120 BPM: 8 s of tone.
  await page.route(`**/remix/projects/${PROJECT_ID}/parts/takes/*/audio`, (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: toneWav(165, 8) }),
  );
  await page.route(`**/remix/projects/${PROJECT_ID}/parts/takes/*`, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const takeId = route.request().url().split("/parts/takes/")[1] ?? "";
    takeDeletes.push(takeId);
    partTakes = partTakes.filter((take) => take.id !== takeId);
    await route.fulfill({ json: { ...mockProject(stems), ...fields, partTakes } });
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
  await page.route("**/catalog/stems/*/preview", (route) => {
    const stemId = route.request().url().split("/stems/")[1]?.split("/")[0];
    return route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: toneWav(STEM_TONES[stemId ?? ""] ?? 330),
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
  /** @type {string[]} */
  const deletes = [];
  await page.route(`**/remix/projects/${PROJECT_ID}/drafts/*`, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const jobId = route.request().url().split("/drafts/")[1] ?? "";
    deletes.push(jobId);
    const metadata =
      /** @type {{ previousDrafts?: Array<{ jobId: string }> } | undefined} */ (
        fields.generationMetadata
      );
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
  return { patches, deletes, partGenerates, takeDeletes };
}
