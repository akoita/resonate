import { computeListeningLanes } from "../modules/agents/listening_lanes";
import type { AgentTasteSignalInput } from "../modules/agents/agent_learning.service";
import { isRightNowContext, resolveRightNow } from "../modules/agents/agent_right_now";
import { MY_MIX_CONTEXTS } from "../modules/agents/agent_my_mix";

const NOW = new Date("2026-07-01T12:00:00.000Z");
let counter = 0;

/** Two distinct browser sessions of the same habit, so a lane forms. */
function habit(
  genre: string,
  mood: string,
  localHourBucket: string,
  weekdayKind: string,
  sessions = 2,
): AgentTasteSignalInput[] {
  counter += 1;
  return Array.from({ length: sessions }, (_, index) => ({
    action: "complete",
    trackId: `track_${counter}_${index}`,
    sessionKey: `session_${counter}_${index}`,
    createdAt: NOW,
    genre,
    moods: [mood],
    localHourBucket,
    weekdayKind,
  }));
}

function requestedBy(plan: NonNullable<ReturnType<typeof resolveRightNow>["plan"]>) {
  return Object.fromEntries(plan.lanes.map((lane) => [Object.keys(lane.genreWeights)[0], lane.requested]));
}

describe("Right now (#2245)", () => {
  // The same listener: jazz on weekday evenings, electronic on weekday mornings.
  const history = [
    ...habit("Jazz", "Warm", "evening", "weekday"),
    ...habit("Electronic", "Energetic", "morning", "weekday"),
  ];
  const lanes = computeListeningLanes(history, NOW);

  it("derives one habit lane per listening time from the fixture history", () => {
    expect(lanes.map((lane) => Object.keys(lane.genreWeights)[0]).sort()).toEqual(["Electronic", "Jazz"]);
  });

  it("leans jazz in the evening and electronic in the morning for a session with no filters", () => {
    const evening = resolveRightNow(lanes, "evening:weekday", 10);
    const morning = resolveRightNow(lanes, "morning:weekday", 10);

    expect(evening.summary).toEqual({ status: "ready", context: "evening:weekday", highlights: ["Jazz"] });
    expect(morning.summary).toEqual({ status: "ready", context: "morning:weekday", highlights: ["Electronic"] });

    const eveningShare = requestedBy(evening.plan!);
    const morningShare = requestedBy(morning.plan!);
    expect(eveningShare.Jazz).toBeGreaterThan(eveningShare.Electronic);
    expect(morningShare.Electronic).toBeGreaterThan(morningShare.Jazz);
    // The whole batch is allocated, and the plan is My Mix's: no lane is dropped.
    expect(eveningShare.Jazz + eveningShare.Electronic).toBe(10);
    expect(morningShare.Jazz + morningShare.Electronic).toBe(10);
  });

  it("names every habit of the bucket, strongest first, without repeating a genre", () => {
    const mixed = computeListeningLanes([
      ...habit("Jazz", "Warm", "evening", "weekday", 4),
      ...habit("Soul", "Warm", "evening", "weekday", 2),
      ...habit("Electronic", "Energetic", "morning", "weekday"),
    ], NOW);
    const evening = resolveRightNow(mixed, "evening:weekday", 10);
    expect(evening.summary).toMatchObject({ status: "ready", highlights: ["Jazz", "Soul"] });
  });

  it("is a cold start without any lane, and the session keeps the saved vibes", () => {
    const cold = resolveRightNow([], "evening:weekday", 10);
    expect(cold).toEqual({ summary: { status: "cold_start", context: "evening:weekday", reason: "no_history" } });
    expect(cold.plan).toBeUndefined();
  });

  it("is a cold start for a time of day the listener has no habit in", () => {
    const weekend = resolveRightNow(lanes, "night:weekend", 10);
    expect(weekend.summary).toEqual({
      status: "cold_start",
      context: "night:weekend",
      reason: "no_context_history",
    });
    expect(weekend.plan).toBeUndefined();
  });

  it("ignores a stray play in an unusual bucket", () => {
    const stray = computeListeningLanes([
      ...habit("Jazz", "Warm", "evening", "weekday", 6),
      // One soft play of the same lane at night: far below a quarter of its evening weight.
      ...habit("Jazz", "Warm", "night", "weekday", 1),
    ], NOW);
    expect(resolveRightNow(stray, "evening:weekday", 10).summary.status).toBe("ready");
    expect(resolveRightNow(stray, "night:weekday", 10).summary).toMatchObject({
      status: "cold_start",
      reason: "no_context_history",
    });
  });

  it("accepts exactly the eight coarse buckets", () => {
    expect(MY_MIX_CONTEXTS.every(isRightNowContext)).toBe(true);
    for (const value of ["lunch:weekday", "evening", "Europe/Paris", "", 3, null, undefined]) {
      expect(isRightNowContext(value)).toBe(false);
    }
  });

  it("does not expose lane ids, weights or history in the summary", () => {
    const serialized = JSON.stringify(resolveRightNow(lanes, "evening:weekday", 10).summary);
    expect(serialized).not.toMatch(/lane_[a-f0-9]{8}/);
    expect(serialized).not.toContain("session_");
    expect(serialized).not.toContain("track_");
  });
});
