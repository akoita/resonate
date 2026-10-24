import { describe, expect, it } from "vitest";
import type { AgentSessionRequest } from "../../lib/api";
import { SESSION_PRESETS } from "./AgentSessionPresets";
import { requestFromPreset } from "../../lib/agentSessionRequest";
import { buildPickPreferences, buildSessionPreferences, toIntentPreferences } from "./sessionPreferences";

const SAVED_VIBES = ["Chill", "Deep House"];

function request(overrides: Partial<AgentSessionRequest> = {}): AgentSessionRequest {
  return { genres: [], moods: [], energy: null, bpm: null, ...overrides };
}

describe("buildSessionPreferences", () => {
  it("returns nothing to steer without filters or a preset", () => {
    expect(buildSessionPreferences({ activePreset: null, request: null })).toBeUndefined();
    expect(buildSessionPreferences({ activePreset: null, request: request() })).toBeUndefined();
  });

  it("carries no genres for a mood-only request, so the saved vibes never narrow it", () => {
    const preferences = buildSessionPreferences({ activePreset: null, request: request({ moods: ["calm"] }) });
    expect(preferences?.genres).toEqual([]);
    expect(preferences?.mood).toBe("calm");
    expect(preferences?.request).toEqual(request({ moods: ["calm"] }));
  });

  it("carries no genres for an energy-only request", () => {
    expect(buildSessionPreferences({ activePreset: null, request: request({ energy: "high" }) })?.genres).toEqual([]);
  });

  it("uses the requested genres when the request names some", () => {
    const preferences = buildSessionPreferences({
      activePreset: null,
      request: request({ genres: ["Jazz"], moods: ["calm"] }),
    });
    expect(preferences?.genres).toEqual(["Jazz"]);
    expect(preferences?.source).toBe("agent_session_prompt");
  });

  it("keeps an untouched preset's own preferences", () => {
    const preset = SESSION_PRESETS[0];
    expect(buildSessionPreferences({ activePreset: preset, request: null })).toEqual(toIntentPreferences(preset));
  });
});

describe("buildPickPreferences", () => {
  it("starts a request with no filters at all from the saved vibes", () => {
    expect(buildPickPreferences({ activePreset: null, request: null, savedVibes: SAVED_VIBES })).toEqual({
      genres: SAVED_VIBES,
      requestText: "",
      artists: [],
      // No seed: cleared explicitly, because the server keeps a session's earlier seed otherwise (#2244).
      seed: null,
    });
  });

  it("keeps the saved vibes but sends the emptied request when every chip was removed", () => {
    expect(buildPickPreferences({ activePreset: null, request: request(), savedVibes: SAVED_VIBES })).toEqual({
      genres: SAVED_VIBES,
      request: request(),
      requestText: "",
      artists: [],
      // No seed: cleared explicitly, because the server keeps a session's earlier seed otherwise (#2244).
      seed: null,
    });
  });

  it("does not inject the saved vibes into a mood-only request", () => {
    const preferences = buildPickPreferences({
      activePreset: null,
      request: request({ moods: ["calm"] }),
      savedVibes: SAVED_VIBES,
    });
    expect(preferences.genres).toEqual([]);
    expect(preferences.mood).toBe("calm");
  });

  it("uses the requested genres over the saved vibes", () => {
    expect(
      buildPickPreferences({ activePreset: null, request: request({ genres: ["Jazz"] }), savedVibes: SAVED_VIBES }).genres,
    ).toEqual(["Jazz"]);
  });
});

describe("the typed sentence and its artists (#2241)", () => {
  it("travels with a typed session, beside the chips", () => {
    expect(
      buildSessionPreferences({
        activePreset: null,
        request: request({ genres: ["Neo Soul"] }),
        sentence: "  neo soul like Nadia Okoro ",
        artists: ["Nadia Okoro"],
      }),
    ).toMatchObject({
      requestText: "neo soul like Nadia Okoro",
      artists: ["Nadia Okoro"],
      request: request({ genres: ["Neo Soul"] }),
      genres: ["Neo Soul"],
    });
  });

  it("still steers when the chips captured nothing", () => {
    expect(
      buildSessionPreferences({ activePreset: null, request: request(), sentence: "something for cooking" }),
    ).toEqual({ requestText: "something for cooking", source: "agent_session_prompt" });
    expect(
      buildSessionPreferences({ activePreset: null, request: request(), sentence: "like X", artists: ["X Y"] }),
    ).toMatchObject({ artists: ["X Y"] });
  });

  it("is never sent for a starter", () => {
    const preset = SESSION_PRESETS[0];
    const preferences = buildSessionPreferences({
      activePreset: preset,
      request: requestFromPreset(preset),
      sentence: preset.sentence,
      artists: ["X"],
    });
    expect(JSON.stringify(preferences)).not.toContain("requestText");
    expect(preferences).not.toHaveProperty("artists");
  });

  it("clears a dropped sentence on the next pick, because the server remembers earlier preferences", () => {
    expect(
      buildPickPreferences({ activePreset: null, request: request({ moods: ["calm"] }), savedVibes: SAVED_VIBES }),
    ).toMatchObject({ requestText: "", artists: [] });
  });

  describe("session seed (#2244)", () => {
    const seed = { kind: "playlist", id: "pl-1", label: "Late night" } as const;

    it("rides along with a preset, with typed filters, and with nothing else", () => {
      const preset = SESSION_PRESETS[0];
      expect(buildSessionPreferences({ activePreset: preset, request: null, seed })).toMatchObject({ seed });
      expect(
        buildSessionPreferences({ activePreset: null, request: request({ genres: ["Soul"] }), seed }),
      ).toMatchObject({ seed, genres: ["Soul"] });
      expect(buildSessionPreferences({ activePreset: null, request: null, seed })).toEqual({
        seed,
        source: "agent_session_prompt",
      });
      expect(buildSessionPreferences({ activePreset: null, request: null })).toBeUndefined();
    });

    it("is sent on every pick while set, and cleared with null once removed", () => {
      expect(
        buildPickPreferences({ activePreset: null, request: request({ moods: ["calm"] }), savedVibes: SAVED_VIBES, seed }),
      ).toMatchObject({ seed });
      expect(buildPickPreferences({ activePreset: null, request: null, savedVibes: SAVED_VIBES, seed })).toMatchObject({ seed });
      expect(buildPickPreferences({ activePreset: null, request: null, savedVibes: SAVED_VIBES })).toMatchObject({ seed: null });
    });
  });
});

describe("Fill with similar sounds (#2316)", () => {
  const rap = request({ genres: ["Rap"] });

  it("is sent to a session start only when on, so an untouched session is exactly what it was", () => {
    expect(buildSessionPreferences({ activePreset: null, request: rap })).not.toHaveProperty("fillSimilar");
    expect(buildSessionPreferences({ activePreset: null, request: rap, fillSimilar: false })).not.toHaveProperty("fillSimilar");
    expect(buildSessionPreferences({ activePreset: null, request: rap, fillSimilar: true })).toMatchObject({
      fillSimilar: true,
      genres: ["Rap"],
    });
    expect(buildSessionPreferences({ activePreset: null, request: null, fillSimilar: true })).toBeUndefined();
  });

  it("is stated either way on a pick, because the server keeps the last value when the key is omitted", () => {
    expect(buildPickPreferences({ activePreset: null, request: rap, savedVibes: SAVED_VIBES, fillSimilar: true })).toMatchObject({
      fillSimilar: true,
    });
    expect(buildPickPreferences({ activePreset: null, request: rap, savedVibes: SAVED_VIBES, fillSimilar: false })).toMatchObject({
      fillSimilar: false,
    });
    expect(buildPickPreferences({ activePreset: null, request: null, savedVibes: SAVED_VIBES, fillSimilar: false })).toMatchObject({
      fillSimilar: false,
    });
    expect(buildPickPreferences({ activePreset: null, request: rap, savedVibes: SAVED_VIBES })).not.toHaveProperty("fillSimilar");
  });

  it("rides along with a starter", () => {
    expect(
      buildPickPreferences({ activePreset: SESSION_PRESETS[SESSION_PRESETS.length - 1], request: null, fillSimilar: true }),
    ).toMatchObject({ fillSimilar: true });
  });
});

describe("New artists only (#2249)", () => {
  const jazz = SESSION_PRESETS.find((preset) => preset.group === "genre")!;

  it("rides with the Sounds starter on a start, and only when on", () => {
    const on = buildSessionPreferences({ activePreset: jazz, request: null, newArtists: true });
    expect(on).toMatchObject({ sessionIntent: jazz.intent, newArtists: true });
    expect(buildSessionPreferences({ activePreset: jazz, request: null, newArtists: false })).not.toHaveProperty("newArtists");
    expect(buildSessionPreferences({ activePreset: jazz, request: null })).not.toHaveProperty("newArtists");
    expect(buildSessionPreferences({ activePreset: null, request: null })).toBeUndefined();
  });

  it("is stated either way on a pick, so turning it off reaches the server", () => {
    const on = buildPickPreferences({ activePreset: jazz, request: requestFromPreset(jazz), newArtists: true });
    const off = buildPickPreferences({ activePreset: jazz, request: requestFromPreset(jazz), newArtists: false });
    const unknown = buildPickPreferences({ activePreset: jazz, request: requestFromPreset(jazz) });
    expect(on.newArtists).toBe(true);
    expect(off.newArtists).toBe(false);
    expect(unknown).not.toHaveProperty("newArtists");
    // A removed chip leaves a session with no filters: still stated, so the earlier value is replaced.
    expect(buildPickPreferences({ activePreset: null, request: request(), savedVibes: SAVED_VIBES, newArtists: false }))
      .toMatchObject({ genres: SAVED_VIBES, newArtists: false });
  });
});
