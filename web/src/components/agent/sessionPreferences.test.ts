import { describe, expect, it } from "vitest";
import type { AgentSessionRequest } from "../../lib/api";
import { SESSION_PRESETS } from "./AgentSessionPresets";
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
    });
  });

  it("keeps the saved vibes but sends the emptied request when every chip was removed", () => {
    expect(buildPickPreferences({ activePreset: null, request: request(), savedVibes: SAVED_VIBES })).toEqual({
      genres: SAVED_VIBES,
      request: request(),
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
