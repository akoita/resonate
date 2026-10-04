import { buildHabitMixQualityReport } from "../modules/analytics/analytics_habit_mix_quality";
import type { AnalyticsFactRow } from "../modules/analytics/analytics_warehouse";

let factSequence = 0;

function fact(
  eventName: string,
  at: number,
  dimensions: Record<string, unknown> = {},
  eventId?: string,
): AnalyticsFactRow {
  factSequence += 1;
  return {
    factId: `fact-${factSequence}`,
    factType: `${eventName.split(".")[0]}_event`,
    eventId: eventId ?? `event-${factSequence}`,
    occurredAt: new Date(at).toISOString(),
    occurredDate: new Date(at).toISOString().slice(0, 10),
    count: 1,
    dimensions: { eventName, ...dimensions },
  };
}

function impression(
  at: number,
  overrides: Record<string, unknown> = {},
): AnalyticsFactRow {
  return fact("recommendation.generated", at, {
    actorId: "actor_private_1",
    agentSessionId: "agent_private_1",
    trackId: "track_private_1",
    surface: "dj",
    sessionSource: "my_mix",
    experimentKey: "habit-exp",
    rankerVariant: "my_mix_habits",
    orderingVariant: "habit",
    explorationPick: false,
    ...overrides,
  });
}

function start(
  at: number,
  overrides: Record<string, unknown> = {},
  eventId?: string,
): AnalyticsFactRow {
  return fact("playback.started", at, {
    actorId: "actor_private_1",
    sessionId: "browser_private_1",
    agentSessionId: "agent_private_1",
    playbackInstanceId: "playback_private_1",
    trackId: "track_private_1",
    ...overrides,
  }, eventId);
}

function outcome(
  eventName: "playback.skipped" | "playback.completed",
  at: number,
  overrides: Record<string, unknown> = {},
  eventId?: string,
): AnalyticsFactRow {
  return fact(eventName, at, {
    actorId: "actor_private_1",
    sessionId: "browser_private_1",
    agentSessionId: "agent_private_1",
    playbackInstanceId: "playback_private_1",
    trackId: "track_private_1",
    positionMs: 20_000,
    durationMs: 60_000,
    completionRatio: 0.9,
    ...overrides,
  }, eventId);
}

describe("buildHabitMixQualityReport", () => {
  beforeEach(() => {
    factSequence = 0;
  });

  it("joins attributed playback episodes and reports bounded source metrics without identifiers", () => {
    const base = Date.parse("2026-09-30T10:00:00.000Z");
    const facts = [
      impression(base, { explorationPick: true }),
      start(base + 100),
      outcome("playback.skipped", base + 20_000, { positionMs: 29_999 }),
      outcome("playback.completed", base + 50_000, { positionMs: 80_000, durationMs: 60_000 }),
      fact("library.saved", base + 51_000, {
        actorId: "actor_private_1",
        sessionId: "browser_private_1",
        trackId: "track_private_1",
        surface: "dj",
      }),
      fact("playlist.track_added", base + 52_000, {
        actorId: "actor_private_1",
        trackIds: ["track_private_1"],
        producer: "playlist-service",
      }),
    ];

    const report = buildHabitMixQualityReport(facts);
    expect(report.sessionSourceBreakdown).toHaveLength(3);
    expect(report.sessionSourceBreakdown.map((row) => row.sessionSource)).toEqual([
      "my_mix",
      "preset",
      "described",
    ]);
    const myMix = report.sessionSourceBreakdown[0];
    expect(myMix).toMatchObject({
      impressions: 1,
      plays: 1,
      skips: 1,
      earlySkips: 1,
      completions: 1,
      saves: 1,
      playlistAdds: 1,
      resonance: 1,
      explorationPlays: 1,
      explorationAccepted: 1,
      sessions: 1,
      sessionTracks: 1,
      averageTracksPerSession: 1,
      playedMinutes: 1,
      averagePlayedMinutesPerSession: 1,
      skipRate: 1,
      earlySkipRate: 1,
      completionRate: 1,
      saveRate: 1,
      playlistAddRate: 1,
      resonanceRate: 1,
    });
    expect(report.sessionVariantBreakdown).toEqual([
      expect.objectContaining({
        sessionSource: "my_mix",
        experimentKey: "habit-exp",
        rankerVariant: "my_mix_habits",
        orderingVariant: "habit",
        plays: 1,
      }),
    ]);
    expect(report.habitMixMeasurement.counters).toMatchObject({
      validImpressions: 1,
      attributedPlays: 1,
      matchedPlaybackOutcomes: 2,
      attributedSaves: 1,
      attributedPlaylistTrackAdds: 1,
    });
    expect(JSON.stringify(report)).not.toContain("actor_private_1");
    expect(JSON.stringify(report)).not.toContain("browser_private_1");
    expect(JSON.stringify(report)).not.toContain("agent_private_1");
    expect(JSON.stringify(report)).not.toContain("track_private_1");
    expect(JSON.stringify(report)).not.toContain("playback_private_1");
    expect(JSON.stringify(report)).not.toContain("2026-09-30T10:00:00.000Z");
  });

  it("deduplicates event IDs and playback instances and refuses foreign actor, browser, instance, or agent joins", () => {
    const base = Date.parse("2026-09-30T10:00:00.000Z");
    const firstStart = start(base + 100);
    const duplicateStart = start(base + 101, {}, "duplicate-start-copy");
    const sameComposite = {
      ...duplicateStart,
      dimensions: { ...duplicateStart.dimensions, playbackInstanceId: "playback_private_1" },
    };
    const duplicateOutcome = outcome("playback.skipped", base + 1_000, { positionMs: 1_000 });
    const repeatedEventId = {
      ...outcome("playback.skipped", base + 1_001),
      eventId: duplicateOutcome.eventId,
    };
    const report = buildHabitMixQualityReport([
      impression(base),
      firstStart,
      sameComposite,
      duplicateOutcome,
      repeatedEventId,
      outcome("playback.completed", base + 2_000, { actorId: "foreign-actor" }),
      outcome("playback.completed", base + 2_001, { sessionId: "foreign-browser" }),
      outcome("playback.completed", base + 2_002, { playbackInstanceId: "foreign-playback" }),
      outcome("playback.completed", base + 2_003, { agentSessionId: "foreign-agent-session" }),
    ]);

    expect(report.sessionSourceBreakdown[0]).toMatchObject({ plays: 1, skips: 1, earlySkips: 1 });
    expect(report.habitMixMeasurement.counters).toMatchObject({
      duplicateEventIds: 1,
      duplicatePlaybackStarts: 1,
      attributedPlays: 1,
      matchedPlaybackOutcomes: 1,
      unmatchedPlaybackOutcomes: 4,
    });
  });

  it("uses heartbeat progress for 80-percent completion and measured minutes when the 30-second event is too early", () => {
    const base = Date.parse("2026-09-30T10:00:00.000Z");
    const facts = [
      impression(base),
      start(base + 100, { playbackInstanceId: "heartbeat-playback" }),
      fact("playback.completed", base + 30_000, {
        actorId: "actor_private_1",
        sessionId: "browser_private_1",
        agentSessionId: "agent_private_1",
        playbackInstanceId: "heartbeat-playback",
        trackId: "track_private_1",
        completionRatio: 0.166,
        durationMs: 180_000,
      }),
      fact("playback.heartbeat", base + 60_000, {
        actorId: "actor_private_1",
        sessionId: "browser_private_1",
        agentSessionId: "agent_private_1",
        playbackInstanceId: "heartbeat-playback",
        trackId: "track_private_1",
        positionMs: 36_000,
        durationMs: 180_000,
      }),
      fact("playback.heartbeat", base + 150_000, {
        actorId: "actor_private_1",
        sessionId: "browser_private_1",
        agentSessionId: "agent_private_1",
        playbackInstanceId: "heartbeat-playback",
        trackId: "track_private_1",
        positionMs: 150_000,
        durationMs: 180_000,
      }),
    ];
    const report = buildHabitMixQualityReport(facts);
    expect(report.sessionSourceBreakdown[0]).toMatchObject({
      plays: 1,
      completions: 1,
      completionRate: 1,
      playedMinutes: 2.5,
    });
    expect(report.habitMixMeasurement.counters.matchedPlaybackOutcomes).toBe(3);
  });

  it("counts repeated track starts as separate session tracks and keeps the early-skip boundary strict", () => {
    const base = Date.parse("2026-09-30T10:00:00.000Z");
    const replayReport = buildHabitMixQualityReport([
      impression(base),
      start(base + 100, { playbackInstanceId: "first-replay" }),
      impression(base + 200),
      start(base + 300, { playbackInstanceId: "second-replay" }),
      outcome("playback.skipped", base + 500, {
        playbackInstanceId: "first-replay",
        positionMs: 30_000,
      }),
    ]);
    expect(replayReport.sessionSourceBreakdown[0]).toMatchObject({
      plays: 2,
      sessionTracks: 2,
      sessions: 1,
      averageTracksPerSession: 2,
      skips: 1,
      earlySkips: 0,
      earlySkipRate: 0,
    });

    const belowBoundary = buildHabitMixQualityReport([
      impression(base),
      start(base + 100),
      outcome("playback.skipped", base + 500, { positionMs: 29_999 }),
    ]);
    expect(belowBoundary.sessionSourceBreakdown[0]).toMatchObject({ earlySkips: 1, earlySkipRate: 1 });
  });

  it("requires a preceding impression and ignores outcomes before the episode", () => {
    const base = Date.parse("2026-09-30T10:00:00.000Z");
    const report = buildHabitMixQualityReport([
      start(base + 1_000),
      impression(base + 2_000),
      outcome("playback.completed", base + 500),
      outcome("playback.completed", base + 1_500),
    ]);
    expect(report.sessionSourceBreakdown[0]).toMatchObject({ impressions: 1, plays: 0, completions: 0 });
    expect(report.habitMixMeasurement.counters).toMatchObject({
      unattributedPlaybackStarts: 1,
      attributedPlays: 0,
      unmatchedPlaybackOutcomes: 2,
    });

    const missingSessionContext = buildHabitMixQualityReport([
      impression(base),
      start(base + 2_000, { sessionId: undefined, playbackInstanceId: "no-browser-session" }),
      start(base + 3_000, { agentSessionId: undefined, playbackInstanceId: "no-agent-session" }),
    ]);
    expect(missingSessionContext.sessionSourceBreakdown[0]).toMatchObject({ impressions: 1, plays: 0 });
    expect(missingSessionContext.habitMixMeasurement.counters.unattributedPlaybackStarts).toBe(2);
  });

  it("accepts one current legacy same-track episode and rejects repeated or interrupted starts", () => {
    const base = Date.parse("2026-09-30T10:00:00.000Z");
    const legacyStart = start(base + 100, { playbackInstanceId: undefined });
    const legacySkip = outcome("playback.skipped", base + 1_000, {
      playbackInstanceId: undefined,
      positionMs: 29_000,
    });

    const unique = buildHabitMixQualityReport([impression(base), legacyStart, legacySkip]);
    expect(unique.sessionSourceBreakdown[0]).toMatchObject({ plays: 1, skips: 1, earlySkips: 1 });

    const repeatedSameTrack = buildHabitMixQualityReport([
      impression(base),
      start(base + 100, { playbackInstanceId: "first" }),
      impression(base + 200, { trackId: "other-track" }),
      start(base + 300, { playbackInstanceId: "middle", trackId: "other-track" }),
      impression(base + 400, { trackId: "track_private_1" }),
      start(base + 500, { playbackInstanceId: "second" }),
      outcome("playback.completed", base + 1_000, { playbackInstanceId: undefined }),
    ]);
    expect(repeatedSameTrack.sessionSourceBreakdown[0]).toMatchObject({ plays: 3, completions: 0 });
    expect(repeatedSameTrack.habitMixMeasurement.counters.ambiguousLegacyPlaybackOutcomes).toBe(1);

    const interruptedByUntaggedStart = buildHabitMixQualityReport([
      impression(base),
      start(base + 100, { playbackInstanceId: "first" }),
      start(base + 200, {
        actorId: "actor_private_1",
        sessionId: "browser_private_1",
        agentSessionId: undefined,
        playbackInstanceId: "untagged",
      }),
      outcome("playback.skipped", base + 300, { playbackInstanceId: undefined }),
    ]);
    expect(interruptedByUntaggedStart.sessionSourceBreakdown[0]).toMatchObject({ plays: 1, skips: 0 });
    expect(interruptedByUntaggedStart.habitMixMeasurement.counters.unmatchedPlaybackOutcomes).toBe(1);

    const interruptedByDifferentTrack = buildHabitMixQualityReport([
      impression(base),
      start(base + 100, { playbackInstanceId: "first" }),
      start(base + 200, {
        agentSessionId: undefined,
        playbackInstanceId: "other-track-start",
        trackId: "other-track",
      }),
      outcome("playback.skipped", base + 300, { playbackInstanceId: undefined }),
    ]);
    expect(interruptedByDifferentTrack.sessionSourceBreakdown[0]).toMatchObject({ plays: 1, skips: 0 });
    expect(interruptedByDifferentTrack.habitMixMeasurement.counters.unmatchedPlaybackOutcomes).toBe(1);

    const delayedExplicitInstance = buildHabitMixQualityReport([
      impression(base),
      start(base + 100, { playbackInstanceId: "first" }),
      start(base + 200, {
        agentSessionId: undefined,
        playbackInstanceId: "other-track-start",
        trackId: "other-track",
      }),
      outcome("playback.skipped", base + 300, { playbackInstanceId: "first" }),
    ]);
    expect(delayedExplicitInstance.sessionSourceBreakdown[0]).toMatchObject({ plays: 1, skips: 1 });
  });

  it("expands canonical playlist track lists, deduplicates per episode, excludes rail actions, and expires fallback attribution", () => {
    const base = Date.parse("2026-09-30T10:00:00.000Z");
    const facts = [
      impression(base, { trackId: "track-one", explorationPick: true }),
      start(base + 100, { trackId: "track-one", playbackInstanceId: "play-one" }),
      impression(base + 200, { trackId: "track-two", explorationPick: true }),
      start(base + 300, { trackId: "track-two", playbackInstanceId: "play-two" }),
      fact("playlist.track_added", base + 1_000, {
        actorId: "actor_private_1",
        producer: "playlist-service",
        trackIds: ["track-one", "track-two", "track-two"],
      }),
      fact("library.saved", base + 1_100, {
        actorId: "actor_private_1",
        sessionId: "browser_private_1",
        trackId: "track-one",
        surface: "dj",
      }),
      fact("library.saved", base + 1_200, {
        actorId: "actor_private_1",
        trackId: "track-two",
        surface: "dj",
        railId: "rail-private",
      }),
      fact("library.saved", base + 31 * 60_000, {
        actorId: "actor_private_1",
        trackId: "track-one",
        surface: "dj",
      }),
    ];
    const report = buildHabitMixQualityReport(facts);
    expect(report.sessionSourceBreakdown[0]).toMatchObject({
      plays: 2,
      playlistAdds: 2,
      saves: 1,
      resonance: 2,
      resonanceRate: 1,
      explorationPlays: 2,
      explorationAccepted: 1,
    });
    expect(report.habitMixMeasurement.counters).toMatchObject({
      attributedPlaylistTrackAdds: 2,
      attributedSaves: 1,
      excludedRailActions: 1,
      expiredSaveFallbacks: 1,
    });
  });

  it("keeps zero-denominator rates at zero and requires both sample thresholds for promotion", () => {
    const base = Date.parse("2026-09-30T10:00:00.000Z");
    const smallSample = buildHabitMixQualityReport([
      impression(base),
      start(base + 1, { playbackInstanceId: "habit-play" }),
      outcome("playback.completed", base + 2, { playbackInstanceId: "habit-play" }),
      impression(base + 3, {
        rankerVariant: "single_profile",
        orderingVariant: "single_profile",
      }),
      start(base + 4, { playbackInstanceId: "baseline-play" }),
      outcome("playback.skipped", base + 5, { playbackInstanceId: "baseline-play" }),
    ]);
    expect(smallSample.sessionSourceBreakdown.find((row) => row.sessionSource === "preset")).toMatchObject({
      plays: 0,
      skipRate: 0,
      completionRate: 0,
      resonanceRate: 0,
    });
    expect(smallSample.habitMixPromotion).toMatchObject({
      automaticActivation: false,
      minimumSample: { sessions: 100, plays: 500 },
    });
    expect(smallSample.habitMixPromotion.comparisons[0]).toMatchObject({
      eligible: false,
      reason: "minimum sample thresholds not met",
      candidate: { sessions: 1, plays: 1 },
      baseline: { sessions: 1, plays: 1 },
    });

    const largeSampleFacts: AnalyticsFactRow[] = [];
    let timestamp = base;
    for (const [rankerVariant, orderingVariant, outcomeName] of [
      ["my_mix_habits", "habit", "playback.completed"],
      ["single_profile", "single_profile", "playback.skipped"],
    ]) {
      for (let index = 0; index < 500; index += 1) {
        const agentSessionId = `${rankerVariant}-session-${index}`;
        const trackId = `${rankerVariant}-track-${index}`;
        const playbackInstanceId = `${rankerVariant}-playback-${index}`;
        const dims = {
          actorId: `actor-${rankerVariant}-${index}`,
          agentSessionId,
          trackId,
          surface: "dj",
          sessionSource: "my_mix",
          experimentKey: "promotion-exp",
          rankerVariant,
          orderingVariant,
        };
        largeSampleFacts.push(fact("recommendation.generated", timestamp++, dims));
        largeSampleFacts.push(fact("playback.started", timestamp++, {
          ...dims,
          sessionId: `browser-${index}`,
          playbackInstanceId,
        }));
        largeSampleFacts.push(fact(outcomeName, timestamp++, {
          ...dims,
          sessionId: `browser-${index}`,
          playbackInstanceId,
          positionMs: outcomeName === "playback.skipped" ? 10_000 : 60_000,
          durationMs: 60_000,
          completionRatio: outcomeName === "playback.completed" ? 1 : 0,
        }));
      }
    }
    const largeSample = buildHabitMixQualityReport(largeSampleFacts);
    expect(largeSample.habitMixPromotion.comparisons[0]).toMatchObject({
      eligible: true,
      candidate: { sessions: 500, plays: 500, completionRate: 1, skipRate: 0 },
      baseline: { sessions: 500, plays: 500, completionRate: 0, skipRate: 1 },
    });
  });

  it("uses measured duration only when duration is positive and never counts below-threshold completions", () => {
    const base = Date.parse("2026-09-30T10:00:00.000Z");
    const report = buildHabitMixQualityReport([
      impression(base),
      start(base + 1),
      outcome("playback.completed", base + 2, {
        completionRatio: 0.79,
        positionMs: 50_000,
        durationMs: 0,
      }),
    ]);
    expect(report.sessionSourceBreakdown[0]).toMatchObject({ plays: 1, completions: 0, playedMinutes: 0 });
    expect(report.habitMixMeasurement.definitions.playedMinutes).toContain("unknown or non-positive durations contribute no minutes");
  });
});
