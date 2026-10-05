import { prisma } from "../db/prisma";
import {
  AGENT_SIGNAL_WEIGHTS,
  AgentLearningService,
} from "../modules/agents/agent_learning.service";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "../modules/analytics/analytics_consent.service";
import { PrismaAnalyticsEventStore } from "../modules/analytics/analytics_event_store";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import {
  AnalyticsInstrumentationService,
  PlaybackLifecycleAnalyticsInput,
} from "../modules/analytics/analytics_instrumentation.service";
import { DiscoveryJournalService } from "../modules/discovery_journal/discovery_journal.service";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { TasteMemoryService } from "../modules/recommendations/taste_memory.service";
import { EventBus } from "../modules/shared/event_bus";

// #2097: the 30 s counted play and the played-through milestone are separate
// telemetry; together they must leave exactly one `complete` AgentSignal whose
// completion ratio reflects how much of the track was heard.
const TEST_PREFIX = `playedthrough_${Date.now()}_`;
const USER = `${TEST_PREFIX}listener`;
const OPTED_OUT_USER = `${TEST_PREFIX}optedout`;
const NO_CONSENT_USER = `${TEST_PREFIX}noconsent`;
const ARTIST = `${TEST_PREFIX}artist`;
const RELEASE = `${TEST_PREFIX}release`;
const TRACK = `${TEST_PREFIX}track`;
const DURATION_MS = 200_000;
const COUNTED_PLAY_MS = 30_000;
const PLAYED_THROUGH_MS = 185_000;

describe("Playback played-through milestone (integration)", () => {
  const ingest = new AnalyticsIngestService(new PrismaAnalyticsEventStore());
  const instrumentation = new AnalyticsInstrumentationService(
    ingest,
    undefined,
    new AgentLearningService(),
  );
  const journal = new DiscoveryJournalService(
    new TasteMemoryService(new EventBus()),
    new DiscoveryPolicyContextService(),
  );
  const users = [USER, OPTED_OUT_USER, NO_CONSENT_USER];
  let instanceCounter = 0;

  function nextInstance() {
    instanceCounter += 1;
    return `${TEST_PREFIX}instance_${instanceCounter}`;
  }

  function countedPlay(userId: string, playbackInstanceId: string, extra: { agentOriginated?: boolean } = {}) {
    return instrumentation.recordPlaybackCompleted({
      trackId: TRACK,
      artistId: ARTIST,
      sessionId: `${TEST_PREFIX}session`,
      source: "web_player",
      actorId: userId,
      actorUserId: userId,
      playbackInstanceId,
      completionRatio: COUNTED_PLAY_MS / DURATION_MS,
      durationMs: DURATION_MS,
      ...extra,
    });
  }

  function playedThrough(
    userId: string,
    playbackInstanceId: string,
    extra: Partial<PlaybackLifecycleAnalyticsInput> = {},
  ) {
    return instrumentation.recordPlaybackLifecycle({
      action: "played_through",
      trackId: TRACK,
      artistId: ARTIST,
      sessionId: `${TEST_PREFIX}session`,
      source: "web_player",
      actorId: userId,
      actorUserId: userId,
      playbackInstanceId,
      positionMs: PLAYED_THROUGH_MS,
      durationMs: DURATION_MS,
      ...extra,
    });
  }

  function completeRows(userId: string) {
    return prisma.agentSignal.findMany({
      where: { userId, trackId: TRACK },
      orderBy: { createdAt: "asc" },
    });
  }

  function ratioOf(metadata: unknown) {
    return (metadata as { outcome?: { completionRatio?: number } }).outcome?.completionRatio;
  }

  beforeAll(async () => {
    for (const id of users) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    for (const id of [USER, OPTED_OUT_USER]) {
      await prisma.analyticsConsent.create({
        data: {
          userId: id,
          productAnalytics: true,
          policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
          decidedAt: new Date(),
        },
      });
    }
    await prisma.listenerTasteMemorySettings.create({
      data: { userId: OPTED_OUT_USER, agentPlaybackTrainingEnabled: false },
    });
    await prisma.artist.create({ data: { id: ARTIST, displayName: "Played Through Artist" } });
    await prisma.release.create({
      data: {
        id: RELEASE,
        artistId: ARTIST,
        title: "Played Through Release",
        genre: "Deep House",
        status: "published",
        primaryArtist: "Played Through Credit",
      },
    });
    await prisma.track.create({
      data: { id: TRACK, releaseId: RELEASE, title: "Played Through Track", position: 1 },
    });
  });

  beforeEach(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: { in: users } } });
    await prisma.libraryTrack.deleteMany({ where: { userId: { in: users } } });
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: { in: users } } });
    await prisma.libraryTrack.deleteMany({ where: { userId: { in: users } } });
    await prisma.analyticsEvent.deleteMany({
      where: {
        OR: [
          { subjectId: { startsWith: TEST_PREFIX } },
          { actorId: { startsWith: TEST_PREFIX } },
        ],
      },
    });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: { in: users } } });
    await prisma.analyticsConsent.deleteMany({ where: { userId: { in: users } } });
    await prisma.track.deleteMany({ where: { id: TRACK } });
    await prisma.release.deleteMany({ where: { id: RELEASE } });
    await prisma.artist.deleteMany({ where: { id: ARTIST } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it("upgrades the counted play's signal ratio without changing its count, weight or time", async () => {
    const instance = nextInstance();
    await countedPlay(USER, instance);
    const [before] = await completeRows(USER);
    expect(ratioOf(before.metadata)).toBeCloseTo(0.15, 5);

    await playedThrough(USER, instance);

    const rows = await completeRows(USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: before.id,
      action: "complete",
      weight: AGENT_SIGNAL_WEIGHTS.complete,
    });
    expect(rows[0].createdAt).toEqual(before.createdAt);
    expect(ratioOf(rows[0].metadata)).toBeGreaterThanOrEqual(0.9);
    expect(rows[0].metadata).toMatchObject({
      playbackInstanceId: instance,
      outcome: { type: "playback_completed", playedThrough: true, durationMs: DURATION_MS },
    });
  });

  it("keeps playback.completed as the 30 s play and emits a separate played_through event", async () => {
    const instance = nextInstance();
    await countedPlay(USER, instance);
    await playedThrough(USER, instance);

    const events = (await prisma.analyticsEvent.findMany({
      where: { actorId: USER, eventName: { in: ["playback.completed", "playback.played_through"] } },
    })).filter((event) => (event.payload as { playbackInstanceId?: string }).playbackInstanceId === instance);
    const completed = events.filter((event) => event.eventName === "playback.completed");
    expect(completed).toHaveLength(1);
    expect((completed[0].payload as { completionRatio: number }).completionRatio).toBeCloseTo(0.15, 5);
    expect(events.filter((event) => event.eventName === "playback.played_through")).toHaveLength(1);
  });

  it("records the real ratio when the milestone arrives before the counted play", async () => {
    const instance = nextInstance();
    await playedThrough(USER, instance);

    const rows = await completeRows(USER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "complete", weight: AGENT_SIGNAL_WEIGHTS.complete });
    expect(ratioOf(rows[0].metadata)).toBeCloseTo(PLAYED_THROUGH_MS / DURATION_MS, 5);
    expect(rows[0].metadata).toMatchObject({ outcome: { playedThrough: true } });

    // The late counted play is a duplicate of the same instance: still one row, ratio kept.
    await countedPlay(USER, instance);
    const after = await completeRows(USER);
    expect(after).toHaveLength(1);
    expect(ratioOf(after[0].metadata)).toBeCloseTo(PLAYED_THROUGH_MS / DURATION_MS, 5);
  });

  it("is idempotent for a duplicate milestone", async () => {
    const instance = nextInstance();
    await countedPlay(USER, instance);
    await playedThrough(USER, instance);
    const [first] = await completeRows(USER);
    await playedThrough(USER, instance);
    await playedThrough(USER, instance, { positionMs: 190_000 });

    const rows = await completeRows(USER);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    // The ratio only ever goes up.
    expect(ratioOf(rows[0].metadata)).toBeCloseTo(190_000 / DURATION_MS, 5);
    await playedThrough(USER, instance, { positionMs: 181_000 });
    expect(ratioOf((await completeRows(USER))[0].metadata)).toBeCloseTo(190_000 / DURATION_MS, 5);
  });

  it("ignores a milestone without a usable position, duration or ratio", async () => {
    const instance = nextInstance();
    await countedPlay(USER, instance);
    await playedThrough(USER, instance, { positionMs: undefined });
    await playedThrough(USER, instance, { durationMs: undefined });
    await playedThrough(USER, instance, { durationMs: 0 });
    await playedThrough(USER, instance, { positionMs: 100_000 });
    await playedThrough(USER, instance, { playbackInstanceId: undefined });

    const rows = await completeRows(USER);
    expect(rows).toHaveLength(1);
    expect(ratioOf(rows[0].metadata)).toBeCloseTo(0.15, 5);
  });

  it("caps the ratio at 1 when the position overshoots the duration", async () => {
    const instance = nextInstance();
    await playedThrough(USER, instance, { positionMs: DURATION_MS + 5_000 });
    expect(ratioOf((await completeRows(USER))[0].metadata)).toBe(1);
  });

  it("does nothing without analytics consent or with agent-playback training off", async () => {
    await playedThrough(NO_CONSENT_USER, nextInstance());
    await playedThrough(OPTED_OUT_USER, nextInstance());
    await expect(completeRows(NO_CONSENT_USER)).resolves.toHaveLength(0);
    await expect(completeRows(OPTED_OUT_USER)).resolves.toHaveLength(0);

    // An existing signal is not upgraded once training is off.
    const instance = nextInstance();
    await prisma.listenerTasteMemorySettings.update({
      where: { userId: OPTED_OUT_USER },
      data: { agentPlaybackTrainingEnabled: true },
    });
    await countedPlay(OPTED_OUT_USER, instance);
    await prisma.listenerTasteMemorySettings.update({
      where: { userId: OPTED_OUT_USER },
      data: { agentPlaybackTrainingEnabled: false },
    });
    await playedThrough(OPTED_OUT_USER, instance);
    const rows = await completeRows(OPTED_OUT_USER);
    expect(rows).toHaveLength(1);
    expect(ratioOf(rows[0].metadata)).toBeCloseTo(0.15, 5);
  });

  it("does not upgrade a signal recorded before a taste reset", async () => {
    const instance = nextInstance();
    await countedPlay(USER, instance);
    await prisma.listenerTasteMemorySettings.upsert({
      where: { userId: USER },
      create: { userId: USER, resetAt: new Date(Date.now() + 1_000) },
      update: { resetAt: new Date(Date.now() + 1_000) },
    });
    try {
      await playedThrough(USER, instance);
      const rows = await completeRows(USER);
      expect(rows).toHaveLength(1);
      expect(ratioOf(rows[0].metadata)).toBeCloseTo(0.15, 5);
    } finally {
      await prisma.listenerTasteMemorySettings.delete({ where: { userId: USER } });
    }
  });

  it("does not mirror agent-originated playback", async () => {
    await playedThrough(USER, nextInstance(), { agentOriginated: true });
    await expect(completeRows(USER)).resolves.toHaveLength(0);
  });

  it("still turns a different playback instance of the same track into a replay", async () => {
    const first = nextInstance();
    const second = nextInstance();
    await countedPlay(USER, first);
    await playedThrough(USER, first);
    await countedPlay(USER, second);
    await playedThrough(USER, second);

    const rows = await completeRows(USER);
    expect(rows.map((row) => row.action).sort()).toEqual(["complete", "replay"]);
    const replay = rows.find((row) => row.action === "replay");
    expect(replay?.weight).toBe(AGENT_SIGNAL_WEIGHTS.replay);
    expect(ratioOf(replay?.metadata)).toBeGreaterThanOrEqual(0.9);
  });

  it("fills the discovery journal: Almost there first, then the saved discovery", async () => {
    const instance = nextInstance();
    await countedPlay(USER, instance);
    await playedThrough(USER, instance);

    const beforeSave = await journal.getJournal(USER, { now: new Date(Date.now() + 60_000) });
    expect(beforeSave.pending.map((item) => item.trackId)).toEqual([TRACK]);
    expect(beforeSave.groups.flatMap((group) => group.items)).toEqual([]);

    await prisma.libraryTrack.create({
      data: {
        userId: USER,
        source: "remote",
        title: "Played Through Track",
        catalogTrackId: TRACK,
        createdAt: new Date(Date.now() + 1_000),
      },
    });
    const afterSave = await journal.getJournal(USER, { now: new Date(Date.now() + 60_000) });
    expect(afterSave.pending).toEqual([]);
    expect(afterSave.groups.flatMap((group) => group.items)).toEqual([
      expect.objectContaining({ trackId: TRACK, followUp: "saved" }),
    ]);
  });

  it("leaves the journal empty for a 30 s play that was never played through", async () => {
    await countedPlay(USER, nextInstance());
    const result = await journal.getJournal(USER, { now: new Date(Date.now() + 60_000) });
    expect(result.pending).toEqual([]);
    expect(result.groups).toEqual([]);
  });
});
