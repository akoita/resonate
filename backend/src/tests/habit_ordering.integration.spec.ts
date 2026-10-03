import { prisma } from "../db/prisma";
import * as agentLearning from "../modules/agents/agent_learning.service";
import type { ResolvedMyMixLane, ResolvedMyMixPlan } from "../modules/agents/agent_my_mix";
import { HabitOrderingService } from "../modules/agents/habit_ordering.service";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "../modules/analytics/analytics_consent.service";

const TEST_PREFIX = `habit_order_${Date.now()}_`;
const USER_ID = `${TEST_PREFIX}user`;
const OTHER_USER_ID = `${TEST_PREFIX}other`;
const SESSION_ID = `${TEST_PREFIX}agent_session`;
const OTHER_SESSION_ID = `${TEST_PREFIX}other_agent_session`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const AMBIENT_TRACK_ID = `${TEST_PREFIX}ambient_track`;
const DEEP_TRACK_ID = `${TEST_PREFIX}deep_track`;
const SOUL_TRACK_ID = `${TEST_PREFIX}soul_track`;

const PLAN = resolvedPlan([
  lane("lane_ambient", "Ambient", { Ambient: 2 }, { Zen: 1 }, 2),
  lane("lane_deep", "Deep House", { "Deep House": 2 }, { Warm: 1 }, 2),
  lane("lane_soul", "Soul", { Soul: 2 }, { Warm: 1 }, 2),
]);

type EventInput = {
  userId?: string;
  trackId: string;
  browserSessionId?: string;
  action: "accept" | "skip" | "complete" | "replay" | "save";
  playbackInstanceId?: string;
  agentSessionId?: string;
  agoMs: number;
  outcomeType?: string;
  positionMs?: number;
  durationMs?: number;
  telemetryMirror?: boolean;
  agentOriginated?: boolean;
  source?: string;
  databaseSessionId?: string;
};

const service = new HabitOrderingService();
const sequenceBase = Date.now();
let eventSequence = 0;

describe("HabitOrderingService (integration)", () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER_ID, email: `${TEST_PREFIX}@test.resonate` } });
    await prisma.user.create({ data: { id: OTHER_USER_ID, email: `${TEST_PREFIX}other@test.resonate` } });
    await prisma.artist.create({
      data: { id: ARTIST_ID, displayName: "Habit Catalog Artist", payoutAddress: `0x${"a".repeat(40)}` },
    });
    for (const [id, title, genre, moods] of [
      [`${TEST_PREFIX}ambient_release`, "Ambient Release", "Ambient", ["Zen"]],
      [`${TEST_PREFIX}deep_release`, "Deep Release", "Deep House", ["Warm"]],
      [`${TEST_PREFIX}soul_release`, "Soul Release", "Soul", ["Warm"]],
    ] as const) {
      await prisma.release.create({
        data: {
          id,
          artistId: ARTIST_ID,
          title,
          genre,
          moods: [...moods],
          primaryArtist: "Habit Catalog Artist",
          status: "published",
        },
      });
    }
    for (const [id, releaseId, title] of [
      [AMBIENT_TRACK_ID, `${TEST_PREFIX}ambient_release`, "Ambient Track"],
      [DEEP_TRACK_ID, `${TEST_PREFIX}deep_release`, "Deep Track"],
      [SOUL_TRACK_ID, `${TEST_PREFIX}soul_release`, "Soul Track"],
    ] as const) {
      await prisma.track.create({
        data: { id, releaseId, title, artist: "Habit Catalog Artist", position: 1 },
      });
    }
    await prisma.stem.create({
      data: {
        id: `${TEST_PREFIX}ambient_original`,
        trackId: AMBIENT_TRACK_ID,
        type: "original",
        uri: "habit-ordering-measured.wav",
        audioFeatures: {
          schemaVersion: "stem-audio-features/v1",
          extractor: { name: "test", version: "1" },
          tempoBpm: 110,
          tempoConfidence: 0.9,
          energyRms: 0.05,
          onsetDensity: 1,
        },
      },
    });
    await prisma.session.createMany({
      data: [
        { id: SESSION_ID, userId: USER_ID, budgetCapUsd: 10 },
        { id: OTHER_SESSION_ID, userId: OTHER_USER_ID, budgetCapUsd: 10 },
      ],
    });
  });

  beforeEach(async () => {
    eventSequence = 0;
    await clearUserState();
    await grantConsent();
  });

  afterAll(async () => {
    await clearUserState();
    await prisma.license.deleteMany({ where: { sessionId: { in: [SESSION_ID, OTHER_SESSION_ID] } } });
    await prisma.session.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
    await prisma.stem.deleteMany({ where: { trackId: { in: [AMBIENT_TRACK_ID, DEEP_TRACK_ID, SOUL_TRACK_ID] } } });
    await prisma.track.deleteMany({ where: { id: { in: [AMBIENT_TRACK_ID, DEEP_TRACK_ID, SOUL_TRACK_ID] } } });
    await prisma.release.deleteMany({ where: { artistId: ARTIST_ID } });
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } });
    await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
  });

  it("uses only trusted browser telemetry, actual started episodes, and the owner session boundary", async () => {
    await seedLearnedTransitions();
    // Five contradictory unmirrored sequences must not change the result.
    for (let index = 0; index < 10; index += 1) {
      const browser = playbackKey(index + 10);
      await start(AMBIENT_TRACK_ID, browser, 50_000 - index * 1_000, `untrusted-a-${index}`, {
        telemetryMirror: false,
      });
      await start(DEEP_TRACK_ID, browser, 49_000 - index * 1_000, `untrusted-b-${index}`, {
        telemetryMirror: false,
      });
      await outcome(DEEP_TRACK_ID, browser, 48_500 - index * 1_000, "complete", `untrusted-b-${index}`, {
        telemetryMirror: false,
      });
    }
    // Valid-looking metadata is insufficient when the row is an agent-session
    // signal or is attributed to an agent-originated play.
    const foreignBrowser = playbackKey(20);
    await start(AMBIENT_TRACK_ID, foreignBrowser, 40_000, "manual-start", {
      userId: USER_ID,
      source: "agent_session",
      databaseSessionId: SESSION_ID,
    });
    await start(DEEP_TRACK_ID, foreignBrowser, 39_000, "agent-start", {
      agentOriginated: true,
    });
    await outcome(DEEP_TRACK_ID, foreignBrowser, 38_500, "complete", "agent-start", {
      agentOriginated: true,
    });

    const invalidBrowser = "browser-session-without-valid-key";
    for (let index = 0; index < 4; index += 1) {
      await start(AMBIENT_TRACK_ID, invalidBrowser, 34_000 - index * 2_000, `invalid-a-${index}`);
      await start(DEEP_TRACK_ID, invalidBrowser, 33_000 - index * 2_000, `invalid-b-${index}`);
      await outcome(DEEP_TRACK_ID, invalidBrowser, 32_500 - index * 2_000, "complete", `invalid-b-${index}`);
    }

    // A second listener has stronger same-pattern telemetry; its rows must not
    // contribute to the primary listener's ordering.
    const otherBrowser = playbackKey(21);
    for (let index = 0; index < 4; index += 1) {
      await start(AMBIENT_TRACK_ID, otherBrowser, 37_000 - index * 3_000, `other-a-${index}`, {
        userId: OTHER_USER_ID,
      });
      await start(DEEP_TRACK_ID, otherBrowser, 36_000 - index * 3_000, `other-b-${index}`, {
        userId: OTHER_USER_ID,
      });
      await outcome(DEEP_TRACK_ID, otherBrowser, 35_500 - index * 3_000, "complete", `other-b-${index}`, {
        userId: OTHER_USER_ID,
      });
    }

    await start(AMBIENT_TRACK_ID, playbackKey(1), 5_000, "current-boundary", {
      agentSessionId: SESSION_ID,
    });
    // Queued licensing is not proof of what the listener actually started.
    await prisma.license.create({
      data: {
        sessionId: SESSION_ID,
        trackId: DEEP_TRACK_ID,
        type: "personal",
        priceUsd: 0,
        durationSeconds: 0,
      },
    });

    const deepPick = selected("deep-pick", "lane_deep", "Deep House");
    const soulPickOne = selected("duplicate", "lane_soul", "Soul");
    const soulPickTwo = selected("duplicate", "lane_soul", "Soul");
    const unassignedSoul = { ...selected("fallback", undefined, "Soul") };
    const result = await service.orderMyMix(
      USER_ID,
      SESSION_ID,
      [deepPick, soulPickOne, soulPickTwo, unassignedSoul],
      PLAN,
    );

    expect(result).toHaveLength(4);
    expect(result[0]).toBe(soulPickOne);
    expect(result[1]).toBe(soulPickTwo);
    expect(result[2]).toBe(unassignedSoul);
    expect(result[3]).toBe(deepPick);
    expect(new Set(result).size).toBe(4);
  });

  it("uses genre anchors rather than a shared mood to assign historical lanes", async () => {
    const mismatchPlan = resolvedPlan([
      lane("lane_ambient", "Ambient", { Ambient: 2 }, { Warm: 3 }, 3),
      lane("lane_deep", "Deep House", { "Deep House": 2 }, { Warm: 3 }, 2),
    ]);
    for (let index = 0; index < 4; index += 1) {
      const browser = playbackKey(index + 30);
      await start(AMBIENT_TRACK_ID, browser, 90_000 - index * 10_000, `anchor-a-${index}`);
      // Soul shares Warm with both lanes but matches neither genre anchor.
      await start(SOUL_TRACK_ID, browser, 89_000 - index * 10_000, `anchor-b-${index}`);
      await outcome(SOUL_TRACK_ID, browser, 88_500 - index * 10_000, "skip", `anchor-b-${index}`);
    }
    await start(AMBIENT_TRACK_ID, playbackKey(2), 5_000, "anchor-boundary", { agentSessionId: SESSION_ID });
    const ambient = selected("ambient-pick", "lane_ambient", "Ambient");
    const deep = selected("deep-pick", "lane_deep", "Deep House");

    await expect(service.orderMyMix(USER_ID, SESSION_ID, [ambient, deep], mismatchPlan)).resolves.toEqual([ambient, deep]);
  });

  it("uses strength-only neutral ordering when consent is absent, stale, or training is disabled", async () => {
    await seedLearnedTransitions();
    await start(AMBIENT_TRACK_ID, playbackKey(1), 5_000, "current-boundary", { agentSessionId: SESSION_ID });
    const ambient = selected("ambient", "lane_ambient", "Ambient");
    const deep = selected("deep", "lane_deep", "Deep House");
    const soul = selected("soul", "lane_soul", "Soul");
    const weakPlan = resolvedPlan([
      lane("lane_ambient", "Ambient", { Ambient: 1 }, {}, 1),
      lane("lane_deep", "Deep House", { "Deep House": 1 }, {}, 3),
      lane("lane_soul", "Soul", { Soul: 1 }, {}, 2),
    ]);
    const expectedNeutralOrder = [deep, soul, ambient];

    await prisma.analyticsConsent.delete({ where: { userId: USER_ID } });
    await expect(service.orderMyMix(USER_ID, SESSION_ID, [ambient, deep, soul], weakPlan)).resolves.toEqual(expectedNeutralOrder);
    await grantConsent(true, "superseded-policy-version");
    await expect(service.orderMyMix(USER_ID, SESSION_ID, [ambient, deep, soul], weakPlan)).resolves.toEqual(expectedNeutralOrder);
    await grantConsent();
    await prisma.listenerTasteMemorySettings.upsert({
      where: { userId: USER_ID },
      create: { userId: USER_ID, agentPlaybackTrainingEnabled: false },
      update: { agentPlaybackTrainingEnabled: false },
    });
    await expect(service.orderMyMix(USER_ID, SESSION_ID, [ambient, deep, soul], weakPlan)).resolves.toEqual(expectedNeutralOrder);
  });

  it("uses only a measured selected feature against measured current-boundary energy", async () => {
    await start(AMBIENT_TRACK_ID, playbackKey(1), 1_000, "energy-boundary", { agentSessionId: SESSION_ID });
    const inferred = selected("inferred", "lane_deep", "Deep House", "low", "inferred");
    const measured = selected("measured", "lane_soul", "Soul", "medium", "measured");

    const result = await service.orderMyMix(USER_ID, SESSION_ID, [inferred, measured], PLAN);
    expect(result[0]).toBe(measured);
    expect(result[1]).toBe(inferred);
  });

  it("falls back to lane strength when the bounded history reader fails", async () => {
    const weakPlan = resolvedPlan([
      lane("lane_ambient", "Ambient", { Ambient: 1 }, {}, 1),
      lane("lane_deep", "Deep House", { "Deep House": 1 }, {}, 3),
      lane("lane_soul", "Soul", { Soul: 1 }, {}, 2),
    ]);
    const ambient = selected("ambient", "lane_ambient", "Ambient");
    const deep = selected("deep", "lane_deep", "Deep House");
    const soul = selected("soul", "lane_soul", "Soul");
    const historyReader = jest.spyOn(agentLearning, "readTasteHistory")
      .mockRejectedValue(new Error("history unavailable"));
    try {
      await expect(service.orderMyMix(USER_ID, SESSION_ID, [ambient, deep, soul], weakPlan))
        .resolves.toEqual([deep, soul, ambient]);
    } finally {
      historyReader.mockRestore();
    }
  });

  it("breaks history chains after reset and hidden genre, artist, or lane controls", async () => {
    await seedLearnedTransitions();
    await start(AMBIENT_TRACK_ID, playbackKey(1), 5_000, "current-boundary", { agentSessionId: SESSION_ID });
    const ambient = selected("ambient", "lane_ambient", "Ambient");
    const deep = selected("deep", "lane_deep", "Deep House");
    const soul = selected("soul", "lane_soul", "Soul");
    const weakPlan = resolvedPlan([
      lane("lane_ambient", "Ambient", { Ambient: 1 }, {}, 1),
      lane("lane_deep", "Deep House", { "Deep House": 1 }, {}, 3),
      lane("lane_soul", "Soul", { Soul: 1 }, {}, 2),
    ]);
    const neutral = [deep, soul, ambient];

    await prisma.listenerTasteMemorySettings.upsert({
      where: { userId: USER_ID },
      create: { userId: USER_ID, resetAt: new Date() },
      update: { resetAt: new Date() },
    });
    await expect(service.orderMyMix(USER_ID, SESSION_ID, [ambient, deep, soul], weakPlan)).resolves.toEqual(neutral);

    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: USER_ID } });
    for (const [signalType, value, expected] of [
      ["genre", "Deep House", [ambient, deep, soul]],
      ["artist", "Habit Catalog Artist", neutral],
      ["lane", "lane_ambient", neutral],
    ] as const) {
      await prisma.listenerTasteSignalControl.create({
        data: { userId: USER_ID, signalType, value, action: "hidden" },
      });
      await expect(service.orderMyMix(USER_ID, SESSION_ID, [ambient, deep, soul], weakPlan)).resolves.toEqual(expected);
      await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: USER_ID } });
    }
  });

  it("does not use a foreign owner session as the boundary", async () => {
    await start(AMBIENT_TRACK_ID, playbackKey(1), 1_000, "other-owner-start", { agentSessionId: OTHER_SESSION_ID });
    const first = selected("ambient", "lane_ambient", "Ambient");
    const second = selected("deep", "lane_deep", "Deep House");
    await expect(service.orderMyMix(USER_ID, OTHER_SESSION_ID, [second, first], PLAN)).resolves.toEqual([second, first]);
  });
});

async function seedLearnedTransitions() {
  const firstBrowser = playbackKey(100);
  await start(AMBIENT_TRACK_ID, firstBrowser, 120_000, "a-bad-a");
  await start(DEEP_TRACK_ID, firstBrowser, 119_000, "a-bad-b");
  await outcome(DEEP_TRACK_ID, firstBrowser, 118_500, "skip", "a-bad-b");

  const secondBrowser = playbackKey(101);
  await start(AMBIENT_TRACK_ID, secondBrowser, 110_000, "a-good-a");
  await start(SOUL_TRACK_ID, secondBrowser, 109_000, "a-good-c");
  await outcome(SOUL_TRACK_ID, secondBrowser, 108_500, "complete", "a-good-c");

  const thirdBrowser = playbackKey(102);
  await start(SOUL_TRACK_ID, thirdBrowser, 100_000, "c-bad-c");
  await start(DEEP_TRACK_ID, thirdBrowser, 99_000, "c-bad-b");
  await outcome(DEEP_TRACK_ID, thirdBrowser, 98_500, "skip", "c-bad-b");

  const fourthBrowser = playbackKey(103);
  await start(AMBIENT_TRACK_ID, fourthBrowser, 90_000, "a-bad-again-a");
  await start(DEEP_TRACK_ID, fourthBrowser, 89_000, "a-bad-again-b");
  await outcome(DEEP_TRACK_ID, fourthBrowser, 88_500, "skip", "a-bad-again-b");

  const fifthBrowser = playbackKey(104);
  await start(AMBIENT_TRACK_ID, fifthBrowser, 80_000, "a-good-again-a");
  await start(SOUL_TRACK_ID, fifthBrowser, 79_000, "a-good-again-c");
  await outcome(SOUL_TRACK_ID, fifthBrowser, 78_500, "complete", "a-good-again-c");

  const sixthBrowser = playbackKey(105);
  await start(SOUL_TRACK_ID, sixthBrowser, 70_000, "c-bad-again-c");
  await start(DEEP_TRACK_ID, sixthBrowser, 69_000, "c-bad-again-b");
  await outcome(DEEP_TRACK_ID, sixthBrowser, 68_500, "skip", "c-bad-again-b");
}

async function start(
  trackId: string,
  browserSessionId: string,
  agoMs: number,
  playbackInstanceId: string,
  overrides: Partial<EventInput> = {},
) {
  return recordEvent({
    trackId,
    browserSessionId,
    action: "accept",
    playbackInstanceId,
    agoMs,
    outcomeType: "playback_started",
    ...overrides,
  });
}

async function outcome(
  trackId: string,
  browserSessionId: string,
  agoMs: number,
  action: "skip" | "complete" | "replay" | "save",
  playbackInstanceId: string,
  overrides: Partial<EventInput> = {},
) {
  const outcomeType = action === "skip"
    ? "playback_skipped"
    : action === "save"
      ? "library.saved"
      : "playback_completed";
  return recordEvent({
    trackId,
    browserSessionId,
    action,
    playbackInstanceId,
    agoMs,
    outcomeType,
    ...(action === "skip" ? { positionMs: 10_000, durationMs: 180_000 } : {}),
    ...overrides,
  });
}

async function recordEvent(input: EventInput) {
  const actionWeight = input.action === "skip" ? -1 : input.action === "complete" ? 1.5 : input.action === "replay" ? 2 : input.action === "save" ? 3 : 1;
  const metadata = {
    schemaVersion: "agent-signal-metadata/v1",
    telemetryMirror: input.telemetryMirror ?? true,
    playbackSessionId: input.browserSessionId ?? playbackKey(999),
    source: input.source ?? "web_player",
    ...(input.agentOriginated !== undefined ? { agentOriginated: input.agentOriginated } : { agentOriginated: false }),
    ...(input.playbackInstanceId ? { playbackInstanceId: input.playbackInstanceId } : {}),
    ...(input.agentSessionId ? { agentSessionId: input.agentSessionId } : {}),
    outcome: {
      type: input.outcomeType ?? "playback_started",
      ...(input.positionMs !== undefined ? { positionMs: input.positionMs } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    },
  };
  const createdAt = new Date(sequenceBase - input.agoMs + eventSequence++);
  return prisma.agentSignal.create({
    data: {
      userId: input.userId ?? USER_ID,
      sessionId: input.databaseSessionId ?? null,
      trackId: input.trackId,
      action: input.action,
      weight: actionWeight,
      metadata,
      createdAt,
    },
  });
}

function selected(
  id: string,
  mixLaneId: string | undefined,
  genre: string,
  energyBand?: string,
  energySource: "measured" | "inferred" = "inferred",
) {
  return {
    id,
    ...(mixLaneId ? { mixLaneId } : {}),
    release: { genre, moods: genre === "Ambient" ? ["Zen"] : ["Warm"] },
    agentRecommendation: {
      score: 1,
      matchedQueries: [],
      signals: [],
      explanation: [],
      audioFeatures: {
        energyBand: energyBand ?? "low",
        featureSources: { energy: energySource, key: "unavailable", tempo: "inferred" },
      },
    },
  };
}

function lane(
  id: string,
  label: string,
  genreWeights: Record<string, number>,
  moodWeights: Record<string, number>,
  strength: number,
): ResolvedMyMixLane {
  return {
    id,
    label,
    genreWeights,
    moodWeights,
    strength,
    contexts: {},
    energyBand: null,
    requested: 1,
    boost: false,
    addition: false,
    allocationWeight: strength,
  };
}

function resolvedPlan(lanes: ResolvedMyMixLane[]): ResolvedMyMixPlan {
  return { lanes };
}

function playbackKey(value: number) {
  return `playback_${value.toString(16).padStart(32, "0")}`;
}

async function grantConsent(productAnalytics = true, policyVersion = ANALYTICS_CONSENT_POLICY_VERSION) {
  await prisma.analyticsConsent.upsert({
    where: { userId: USER_ID },
    create: { userId: USER_ID, productAnalytics, policyVersion, decidedAt: new Date() },
    update: { productAnalytics, policyVersion, decidedAt: new Date() },
  });
}

async function clearUserState() {
  await prisma.license.deleteMany({ where: { sessionId: { in: [SESSION_ID, OTHER_SESSION_ID] } } });
  await prisma.agentSignal.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.analyticsConsent.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
  await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
}
