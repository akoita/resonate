import { describe, expect, it } from "vitest";
import { DJ_SET_SUMMARY_FALLBACK, DJ_SET_SUMMARY_MAX_LENGTH, describeDjSetRequest } from "./agentDjRequestSummary";

describe("describeDjSetRequest (#2312)", () => {
    it("names the seed first", () => {
        expect(
            describeDjSetRequest({
                seed: { kind: "playlist", id: "p1", label: "Late Night Drive" },
                request: { genres: ["house"], moods: [], energy: null, bpm: null },
            }),
        ).toBe("From Late Night Drive");
    });

    it("joins the request's genres, moods, energy and tempo", () => {
        expect(
            describeDjSetRequest({
                request: { genres: ["world", "afrobeats"], moods: ["chill"], energy: "high", bpm: { min: 100, max: 120 } },
            }),
        ).toBe("World · Afrobeats · Chill mood · High energy · 100–120 BPM");
    });

    it("falls back to the session's genres, mood and energy, deduped and capped", () => {
        expect(
            describeDjSetRequest({ genres: ["jazz", "Jazz", "soul", "funk", "blues"], mood: "warm", energy: "low" }),
        ).toBe("Jazz · Soul · Funk · Warm mood · Low energy");
    });

    it("uses the session intent, then a generic line", () => {
        expect(describeDjSetRequest({ sessionIntentName: "Deep focus" })).toBe("Deep focus");
        expect(describeDjSetRequest({})).toBe(DJ_SET_SUMMARY_FALLBACK);
        expect(describeDjSetRequest(null)).toBe(DJ_SET_SUMMARY_FALLBACK);
    });

    it("never reads the typed sentence", () => {
        const text = describeDjSetRequest({ requestText: "something for my private road trip", genres: ["rock"] });
        expect(text).toBe("Rock");
        expect(describeDjSetRequest({ requestText: "only a sentence" })).toBe(DJ_SET_SUMMARY_FALLBACK);
    });

    it("caps the length", () => {
        const text = describeDjSetRequest({ seed: { kind: "track", id: "t", label: "x".repeat(200) } });
        expect(text.length).toBeLessThanOrEqual(DJ_SET_SUMMARY_MAX_LENGTH);
        expect(text.endsWith("…")).toBe(true);
    });
});
