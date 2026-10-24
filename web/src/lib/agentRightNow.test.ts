import { describe, expect, it } from "vitest";
import type { AgentNextPreferences, AgentRightNow } from "./api";
import { withCurrentMyMixContext } from "./agentMyMix";
import { rightNowPhrase, rightNowReason, withRightNowContext } from "./agentRightNow";

const EVENING = new Date(2026, 9, 5, 19, 30); // a Monday evening, local time
const MORNING = new Date(2026, 9, 3, 8, 0); // a Saturday morning, local time
const emptyRequest = { genres: [], moods: [], energy: null, bpm: null };

describe("Right now reason", () => {
  it("names the habit in plain words", () => {
    const ready: AgentRightNow = {
      status: "ready",
      context: "evening:weekday",
      highlights: ["Deep House", "Jazz"],
    };
    expect(rightNowReason(ready)).toBe("Your usual weekday-evening mix: Deep House, Jazz.");
    expect(rightNowPhrase("morning:weekend")).toBe("weekend-morning");
    expect(rightNowPhrase("night:weekday")).toBe("weekday-night");
  });

  it("says so on a cold start and names the fallback", () => {
    expect(rightNowReason({ status: "cold_start", context: "evening:weekday", reason: "no_history" })).toBe(
      "Not enough listening history yet. Your DJ will start from your saved vibes.",
    );
    expect(
      rightNowReason({ status: "cold_start", context: "morning:weekend", reason: "no_context_history" }),
    ).toBe(
      "Not enough listening history for a weekend-morning yet. Your DJ will start from your saved vibes.",
    );
  });
});

describe("withRightNowContext", () => {
  it("sends only the coarse bucket for a plain start, never a clock reading or a timezone", () => {
    const preferences = withRightNowContext(undefined, EVENING);
    expect(preferences).toEqual({ listeningContext: "evening:weekday" });
    expect(JSON.stringify(preferences)).not.toMatch(/timezone|UTC|2026|19:30|Europe/);
    expect(withRightNowContext(undefined, MORNING)).toEqual({ listeningContext: "morning:weekend" });
  });

  it("keeps the saved vibes of a plain pick as the fallback and adds the bucket", () => {
    const plain: AgentNextPreferences = {
      genres: ["Ambient"],
      request: emptyRequest,
      requestText: "",
      artists: [],
      seed: null,
      fillSimilar: false,
    };
    expect(withRightNowContext(plain, EVENING)).toEqual({ ...plain, listeningContext: "evening:weekday" });
  });

  it.each<[string, AgentNextPreferences]>([
    ["a starter", { sessionIntent: "Focus", sessionIntentName: "Focus", genres: ["Ambient"] }],
    ["a genre filter", { request: { ...emptyRequest, genres: ["Jazz"] }, genres: ["Jazz"] }],
    ["a mood", { mood: "Chill" }],
    ["an energy", { energy: "high" }],
    ["a sentence", { requestText: "something for cooking" }],
    ["an artist", { artists: ["Nadia Okoro"] }],
    ["a seed", { seed: { kind: "artist", id: "a1", label: "Nadia" } }],
    ["a seed track", { seedTrackId: "t1" }],
    ["New artists only", { newArtists: true }],
    ["My Mix", { myMix: { context: "evening:weekday" } }],
  ])("leaves a session with %s untouched: the request decides, not the clock", (_name, preferences) => {
    expect(withRightNowContext(preferences, EVENING)).toBe(preferences);
  });

  it("re-buckets a long session at each request, without touching other preferences", () => {
    const stored: AgentNextPreferences = { genres: ["Ambient"], listeningContext: "morning:weekend" };
    expect(withCurrentMyMixContext(stored, EVENING)).toEqual({
      genres: ["Ambient"],
      listeningContext: "evening:weekday",
    });
    const noContext: AgentNextPreferences = { genres: ["Ambient"] };
    expect(withCurrentMyMixContext(noContext, EVENING)).toBe(noContext);
  });
});
