import { prisma } from "../db/prisma";
import {
  AGENT_SIGNAL_WEIGHTS,
  AgentLearningService,
  buildAgentSignalMetadata,
} from "../modules/agents/agent_learning.service";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "../modules/analytics/analytics_consent.service";
import { TasteMemoryService } from "../modules/recommendations/taste_memory.service";
import { EventBus } from "../modules/shared/event_bus";

const TEST_PREFIX = `aglearn_${Date.now()}_`;
const PRIMARY_USER_ID = `${TEST_PREFIX}user`;
const SECONDARY_USER_ID = `${TEST_PREFIX}other_user`;
const TRACK_ID = `${TEST_PREFIX}track`;

describe("AgentLearningService (integration)", () => {
  const service = new AgentLearningService();

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: PRIMARY_USER_ID, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.user.create({
      data: { id: SECONDARY_USER_ID, email: `${TEST_PREFIX}other@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: PRIMARY_USER_ID,
        displayName: "Learning Artist",
        payoutAddress: `0x${"a".repeat(40)}`,
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: `${TEST_PREFIX}artist`,
        title: "Learning Release",
        genre: "Deep House",
        status: "published",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: `${TEST_PREFIX}release`,
        title: "Learning Track",
        position: 1,
      },
    });
    await prisma.agentConfig.create({
      data: {
        userId: PRIMARY_USER_ID,
        name: "Learning DJ",
        vibes: ["Ambient"],
        monthlyCapUsd: 10,
      },
    });
    await prisma.session.create({
      data: {
        id: `${TEST_PREFIX}session`,
        userId: PRIMARY_USER_ID,
        budgetCapUsd: 10,
      },
    });
    await prisma.agentConfig.create({
      data: {
        userId: SECONDARY_USER_ID,
        name: "Other Learning DJ",
        vibes: [],
        monthlyCapUsd: 10,
      },
    });
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: { in: [PRIMARY_USER_ID, SECONDARY_USER_ID] } } });
    await prisma.analyticsConsent.deleteMany({ where: { userId: { in: [PRIMARY_USER_ID, SECONDARY_USER_ID] } } });
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: { in: [PRIMARY_USER_ID, SECONDARY_USER_ID] } } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: { in: [PRIMARY_USER_ID, SECONDARY_USER_ID] } } });
    await prisma.agentConfig.deleteMany({ where: { userId: { in: [PRIMARY_USER_ID, SECONDARY_USER_ID] } } });
    await prisma.session.deleteMany({ where: { userId: PRIMARY_USER_ID } });
    await prisma.track.deleteMany({ where: { id: TRACK_ID } });
    await prisma.release.deleteMany({ where: { id: `${TEST_PREFIX}release` } });
    await prisma.artist.deleteMany({ where: { id: `${TEST_PREFIX}artist` } });
    await prisma.user.deleteMany({ where: { id: { in: [PRIMARY_USER_ID, SECONDARY_USER_ID] } } });
  });

  it("persists signals and updates AgentConfig taste profile", async () => {
    const profile = await service.recordSignal({
      userId: `${TEST_PREFIX}user`,
      sessionId: `${TEST_PREFIX}session`,
      trackId: `${TEST_PREFIX}track`,
      action: "complete",
      metadata: buildAgentSignalMetadata({
        source: "agent_session",
        sessionIntent: "focus",
        sessionIntentName: "Neural Flow",
        mood: "Focus",
        energy: "low",
        genres: ["Ambient", "Deep House"],
        outcome: {
          type: "playback_completed",
          completionRatio: 0.9,
          durationMs: 120000,
        },
      }),
    });

    expect(profile.favoredGenres).toEqual(["Deep House"]);
    expect(profile.score).toBeGreaterThan(0);

    const signals = await prisma.agentSignal.findMany({
      where: { userId: `${TEST_PREFIX}user` },
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].weight).toBe(1.5);
    expect(signals[0].metadata).toMatchObject({
      schemaVersion: "agent-signal-metadata/v1",
      sessionIntent: "focus",
      mood: "Focus",
      outcome: {
        type: "playback_completed",
        completionRatio: 0.9,
      },
    });

    const config = await prisma.agentConfig.findUnique({
      where: { userId: `${TEST_PREFIX}user` },
    });
    expect(config?.tasteScore).toBe(profile.score);
    expect(config?.learnedTasteProfile).toMatchObject({
      schemaVersion: "agent-taste-profile/v1",
      favoredGenres: ["Deep House"],
    });
  });

  it("annotates existing session signals with session outcome context", async () => {
    await service.annotateSessionOutcome({
      userId: `${TEST_PREFIX}user`,
      sessionId: `${TEST_PREFIX}session`,
      outcome: {
        type: "ended",
        sessionDurationMs: 300000,
        status: "stopped",
      },
    });

    const signal = await prisma.agentSignal.findFirstOrThrow({
      where: {
        userId: `${TEST_PREFIX}user`,
        sessionId: `${TEST_PREFIX}session`,
      },
    });
    expect(signal.metadata).toMatchObject({
      schemaVersion: "agent-signal-metadata/v1",
      sessionIntent: "focus",
      outcome: {
        type: "ended",
        completionRatio: 0.9,
        sessionDurationMs: 300000,
        status: "stopped",
      },
    });
  });

  it("does not train taste memory from agent-originated playback when disabled", async () => {
    const tasteMemory = new TasteMemoryService(new EventBus());
    const governedService = new AgentLearningService(tasteMemory);
    await tasteMemory.updateSettings(`${TEST_PREFIX}user`, {
      agentPlaybackTrainingEnabled: false,
    });
    const before = await prisma.agentSignal.count({ where: { userId: `${TEST_PREFIX}user` } });

    await governedService.recordSignal({
      userId: `${TEST_PREFIX}user`,
      sessionId: `${TEST_PREFIX}session`,
      trackId: `${TEST_PREFIX}track`,
      action: "replay",
      metadata: buildAgentSignalMetadata({
        source: "agent_session",
        mood: "Focus",
      }),
    });

    await expect(prisma.agentSignal.count({ where: { userId: `${TEST_PREFIX}user` } })).resolves.toBe(before);
  });

  describe("analytics telemetry persistence", () => {
    beforeEach(async () => {
      await prisma.agentSignal.deleteMany({
        where: { userId: { in: [PRIMARY_USER_ID, SECONDARY_USER_ID] } },
      });
      await prisma.analyticsConsent.deleteMany({
        where: { userId: { in: [PRIMARY_USER_ID, SECONDARY_USER_ID] } },
      });
      await prisma.listenerTasteMemorySettings.deleteMany({
        where: { userId: { in: [PRIMARY_USER_ID, SECONDARY_USER_ID] } },
      });
      await prisma.listenerTasteSignalControl.deleteMany({
        where: { userId: { in: [PRIMARY_USER_ID, SECONDARY_USER_ID] } },
      });
    });

    async function grantConsent(userId: string, productAnalytics = true, policyVersion = ANALYTICS_CONSENT_POLICY_VERSION) {
      await prisma.analyticsConsent.upsert({
        where: { userId },
        create: { userId, productAnalytics, policyVersion, decidedAt: new Date() },
        update: { productAnalytics, policyVersion, decidedAt: new Date() },
      });
    }

    function recordCompletion(input: {
      userId?: string;
      dedupKey: string;
      playbackInstanceId?: string;
      source?: string;
      agentOriginated?: boolean;
    }) {
      const userId = input.userId ?? SECONDARY_USER_ID;
      return service.recordSignal({
        userId,
        trackId: TRACK_ID,
        action: "complete",
        metadata: buildAgentSignalMetadata({
          source: input.source ?? "web_player",
          agentOriginated: input.agentOriginated ?? false,
          playbackInstanceId: input.playbackInstanceId,
          outcome: { type: "playback_completed", completionRatio: 0.95 },
        }),
        telemetry: {
          dedupKey: input.dedupKey,
          playbackSessionId: `${TEST_PREFIX}browser-session`,
        },
      });
    }

    async function seedCompletion(input: {
      id: string;
      userId?: string;
      createdAt?: Date;
      source?: string;
      agentOriginated?: boolean;
      playbackInstanceId?: string;
      telemetryMirror?: boolean;
    }) {
      const metadata = buildAgentSignalMetadata({
        source: input.source ?? "web_player",
        agentOriginated: input.agentOriginated ?? false,
        playbackInstanceId: input.playbackInstanceId,
        outcome: { type: "playback_completed", completionRatio: 0.95 },
      });
      await prisma.agentSignal.create({
        data: {
          id: input.id,
          userId: input.userId ?? SECONDARY_USER_ID,
          trackId: TRACK_ID,
          action: "complete",
          weight: AGENT_SIGNAL_WEIGHTS.complete,
          metadata: {
            ...metadata,
            ...(input.telemetryMirror ? { telemetryMirror: true } : {}),
          },
          ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        },
      });
    }

    it("requires current product analytics consent and honors the training setting", async () => {
      await expect(recordCompletion({ dedupKey: "no-consent" })).resolves.toBeNull();

      await grantConsent(SECONDARY_USER_ID, true, `${ANALYTICS_CONSENT_POLICY_VERSION}-old`);
      await expect(recordCompletion({ dedupKey: "stale-consent" })).resolves.toBeNull();

      await grantConsent(SECONDARY_USER_ID, false);
      await expect(recordCompletion({ dedupKey: "refused-consent" })).resolves.toBeNull();

      await grantConsent(SECONDARY_USER_ID);
      await prisma.listenerTasteMemorySettings.create({
        data: { userId: SECONDARY_USER_ID, agentPlaybackTrainingEnabled: false },
      });
      await expect(recordCompletion({ dedupKey: "training-disabled" })).resolves.toBeNull();
      await expect(prisma.agentSignal.count({ where: { userId: SECONDARY_USER_ID } })).resolves.toBe(0);

      await prisma.listenerTasteMemorySettings.delete({ where: { userId: SECONDARY_USER_ID } });
      await expect(recordCompletion({ dedupKey: "default-training-enabled" })).resolves.not.toBeNull();
      await expect(prisma.agentSignal.count({ where: { userId: SECONDARY_USER_ID } })).resolves.toBe(1);
    });

    it("deduplicates concurrent retries and only returns a refreshed profile for the writer", async () => {
      await grantConsent(SECONDARY_USER_ID);
      const input = {
        dedupKey: "completion:concurrent-instance",
        playbackInstanceId: "concurrent-instance",
      };

      const results = await Promise.all(
        Array.from({ length: 8 }, () => recordCompletion(input)),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      await expect(prisma.agentSignal.count({ where: { userId: SECONDARY_USER_ID } })).resolves.toBe(1);

      const profileUpdatedAt = (await prisma.agentConfig.findUniqueOrThrow({
        where: { userId: SECONDARY_USER_ID },
        select: { updatedAt: true },
      })).updatedAt;
      await new Promise((resolve) => setTimeout(resolve, 20));
      await expect(recordCompletion(input)).resolves.toBeNull();
      await expect(prisma.agentConfig.findUniqueOrThrow({
        where: { userId: SECONDARY_USER_ID },
        select: { updatedAt: true },
      })).resolves.toMatchObject({ updatedAt: profileUpdatedAt });
    });

    it("serializes distinct concurrent writes before refreshing the taste profile", async () => {
      await grantConsent(SECONDARY_USER_ID);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, index) => service.recordSignal({
          userId: SECONDARY_USER_ID,
          trackId: TRACK_ID,
          action: "accept",
          metadata: buildAgentSignalMetadata({
            source: "web_player",
            outcome: { type: "playback_started" },
          }),
          telemetry: {
            dedupKey: `start:${index}`,
            playbackSessionId: `${TEST_PREFIX}browser-session`,
          },
        })),
      );
      expect(results.every(Boolean)).toBe(true);
      await expect(prisma.agentSignal.count({ where: { userId: SECONDARY_USER_ID } })).resolves.toBe(8);

      const config = await prisma.agentConfig.findUniqueOrThrow({
        where: { userId: SECONDARY_USER_ID },
        select: { learnedTasteProfile: true },
      });
      expect(config.learnedTasteProfile).toMatchObject({
        signals: 8,
        genreWeights: { "Deep House": 8 },
      });
    });

    it("deduplicates loop intent per user, track, and browser session", async () => {
      await grantConsent(PRIMARY_USER_ID);
      await grantConsent(SECONDARY_USER_ID);
      const recordLoop = (userId: string, sessionId: string) => service.recordSignal({
        userId,
        trackId: TRACK_ID,
        action: "loop",
        metadata: buildAgentSignalMetadata({
          source: "web_app",
          outcome: { type: "player.segment_loop_enabled" },
        }),
        telemetry: {
          dedupKey: JSON.stringify(["loop", TRACK_ID, sessionId]),
          playbackSessionId: sessionId,
        },
      });

      await expect(recordLoop(SECONDARY_USER_ID, "same-browser-session")).resolves.not.toBeNull();
      await expect(recordLoop(SECONDARY_USER_ID, "same-browser-session")).resolves.toBeNull();
      await expect(recordLoop(SECONDARY_USER_ID, "another-browser-session")).resolves.not.toBeNull();
      await expect(recordLoop(PRIMARY_USER_ID, "same-browser-session")).resolves.not.toBeNull();

      const rows = await prisma.agentSignal.findMany({
        where: { userId: { in: [PRIMARY_USER_ID, SECONDARY_USER_ID] }, action: "loop" },
      });
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.sessionId === null)).toBe(true);
      const userSessions = rows
        .filter((row) => row.userId === SECONDARY_USER_ID)
        .map((row) => (row.metadata as Record<string, unknown>).playbackSessionId);
      expect(userSessions).toHaveLength(2);
      expect(userSessions.every((session) => typeof session === "string" && session.startsWith("playback_"))).toBe(true);
      expect(userSessions).not.toContain("same-browser-session");
    });

    it("records unsaves with the centralized negative weight", async () => {
      await grantConsent(SECONDARY_USER_ID);
      await service.recordSignal({
        userId: SECONDARY_USER_ID,
        trackId: TRACK_ID,
        action: "unsave",
        metadata: buildAgentSignalMetadata({
          source: "library",
          outcome: { type: "library.removed" },
        }),
        telemetry: { dedupKey: "unsave:client-event-1" },
      });

      const signal = await prisma.agentSignal.findFirstOrThrow({
        where: { userId: SECONDARY_USER_ID, trackId: TRACK_ID },
      });
      expect(signal.action).toBe("unsave");
      expect(signal.weight).toBe(-2);
      expect(signal.weight).toBe(AGENT_SIGNAL_WEIGHTS.unsave);
    });

    it("keeps first completions as complete, maps recent legacy completions to replay, and excludes the current instance", async () => {
      await grantConsent(SECONDARY_USER_ID);
      await recordCompletion({ dedupKey: "first:instance-1", playbackInstanceId: "instance-1" });
      await recordCompletion({ dedupKey: "repeat:instance-2", playbackInstanceId: "instance-2" });
      let signals = await prisma.agentSignal.findMany({ where: { userId: SECONDARY_USER_ID } });
      expect(signals.find((signal) => (signal.metadata as Record<string, unknown>).playbackInstanceId === "instance-1")?.action).toBe("complete");
      expect(signals.find((signal) => (signal.metadata as Record<string, unknown>).playbackInstanceId === "instance-2")?.action).toBe("replay");

      await prisma.agentSignal.deleteMany({ where: { userId: SECONDARY_USER_ID } });
      await seedCompletion({ id: `${TEST_PREFIX}legacy_recent` });
      await recordCompletion({ dedupKey: "legacy-repeat", playbackInstanceId: "new-instance" });
      signals = await prisma.agentSignal.findMany({ where: { userId: SECONDARY_USER_ID } });
      expect(signals.find((signal) => signal.id !== `${TEST_PREFIX}legacy_recent`)?.action).toBe("replay");

      await prisma.agentSignal.deleteMany({ where: { userId: SECONDARY_USER_ID } });
      await seedCompletion({ id: `${TEST_PREFIX}same_instance`, playbackInstanceId: "same-instance" });
      await recordCompletion({ dedupKey: "same-instance-next", playbackInstanceId: "same-instance" });
      signals = await prisma.agentSignal.findMany({ where: { userId: SECONDARY_USER_ID } });
      expect(signals.find((signal) => signal.id !== `${TEST_PREFIX}same_instance`)?.action).toBe("complete");
    });

    it("ignores stale history and completions before the taste reset", async () => {
      await grantConsent(SECONDARY_USER_ID);
      const staleAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      await seedCompletion({ id: `${TEST_PREFIX}stale`, createdAt: staleAt });
      await recordCompletion({ dedupKey: "after-stale", playbackInstanceId: "after-stale" });
      let signal = await prisma.agentSignal.findFirstOrThrow({
        where: { userId: SECONDARY_USER_ID, id: { not: `${TEST_PREFIX}stale` } },
      });
      expect(signal.action).toBe("complete");

      await prisma.agentSignal.deleteMany({ where: { userId: SECONDARY_USER_ID } });
      const priorCompletionAt = new Date(Date.now() - 60 * 60 * 1000);
      const resetAt = new Date(Date.now() - 30 * 60 * 1000);
      await seedCompletion({ id: `${TEST_PREFIX}before_reset`, createdAt: priorCompletionAt });
      await prisma.listenerTasteMemorySettings.create({
        data: { userId: SECONDARY_USER_ID, resetAt },
      });
      const refreshedProfile = await recordCompletion({
        dedupKey: "after-reset",
        playbackInstanceId: "after-reset",
      });
      expect(refreshedProfile?.signals).toBe(1);
      signal = await prisma.agentSignal.findFirstOrThrow({
        where: { userId: SECONDARY_USER_ID, id: { not: `${TEST_PREFIX}before_reset` } },
      });
      expect(signal.action).toBe("complete");
    });

    it("applies hidden taste controls when refreshing without an injected TasteMemoryService", async () => {
      await grantConsent(SECONDARY_USER_ID);
      await prisma.listenerTasteSignalControl.create({
        data: {
          userId: SECONDARY_USER_ID,
          signalType: "genre",
          value: "Deep House",
          action: "hidden",
        },
      });

      const profile = await recordCompletion({ dedupKey: "hidden-genre", playbackInstanceId: "hidden-genre" });
      expect(profile).toMatchObject({
        signals: 0,
        genreWeights: {},
        genresExplored: [],
      });
    });

    it("does not turn manual or agent-originated completions into replay evidence", async () => {
      await grantConsent(SECONDARY_USER_ID);
      await seedCompletion({ id: `${TEST_PREFIX}manual`, source: "manual" });
      await seedCompletion({
        id: `${TEST_PREFIX}agent`,
        source: "agent_session",
        telemetryMirror: true,
      });
      await seedCompletion({
        id: `${TEST_PREFIX}agent_originated`,
        source: "web_player",
        agentOriginated: true,
        telemetryMirror: true,
      });

      await recordCompletion({ dedupKey: "manual-agent-exclusion", playbackInstanceId: "listener-instance" });
      const signal = await prisma.agentSignal.findFirstOrThrow({
        where: { userId: SECONDARY_USER_ID, id: { notIn: [
          `${TEST_PREFIX}manual`, `${TEST_PREFIX}agent`, `${TEST_PREFIX}agent_originated`,
        ] } },
      });
      expect(signal.action).toBe("complete");
    });
  });
});
