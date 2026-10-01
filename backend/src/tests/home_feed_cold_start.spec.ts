/**
 * Home cold-start decision (#2006) — pure unit tests of `isColdStart`.
 *
 * A listener whose only declared taste is a boosted genre or mood (#1961) is
 * not cold: they get the personalized rails, not the "Catalog signal" rail.
 */
import { isColdStart } from "../modules/recommendations/home-feed.service";
import {
  buildPolicy,
  TasteMemorySettingsDto,
  TasteSignalControlDto,
} from "../modules/recommendations/taste_memory.service";

const settings: TasteMemorySettingsDto = {
  socialMatchingEnabled: false,
  citySceneDiscoveryEnabled: false,
  agentPlaybackTrainingEnabled: true,
  recommendationExplanationPreference: "balanced",
  resetAt: null,
};

let nextId = 0;
function control(
  signalType: TasteSignalControlDto["signalType"],
  value: string,
  action: TasteSignalControlDto["action"],
): TasteSignalControlDto {
  nextId += 1;
  return {
    id: `c${nextId}`,
    signalType,
    value,
    action,
    source: "declared_text_edit",
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("isColdStart", () => {
  it("is cold with no preference, no declared boost and no plays", () => {
    expect(isColdStart({ preferences: {}, playedArtistCount: 0 })).toBe(true);
    expect(
      isColdStart({ preferences: { genres: [], mood: "  " }, playedArtistCount: 0, tastePolicy: buildPolicy(settings, []) }),
    ).toBe(true);
  });

  it("a saved preference or a played artist is not cold (unchanged)", () => {
    expect(isColdStart({ preferences: { genres: ["Jazz"] }, playedArtistCount: 0 })).toBe(false);
    expect(isColdStart({ preferences: { mood: "Focus" }, playedArtistCount: 0 })).toBe(false);
    expect(isColdStart({ preferences: {}, playedArtistCount: 1 })).toBe(false);
  });

  it("a declared boosted genre alone lifts the listener out of cold start", () => {
    const tastePolicy = buildPolicy(settings, [control("genre", "Jazz", "boosted")]);
    expect(isColdStart({ preferences: {}, playedArtistCount: 0, tastePolicy })).toBe(false);
  });

  it("a declared boosted mood alone lifts the listener out of cold start", () => {
    const tastePolicy = buildPolicy(settings, [control("mood", "Focus", "boosted")]);
    expect(isColdStart({ preferences: {}, playedArtistCount: 0, tastePolicy })).toBe(false);
  });

  it("downranks, hides, written notes and energy alone keep the listener cold", () => {
    const tastePolicy = buildPolicy(settings, [
      control("genre", "Drill", "downranked"),
      control("artist", "Someone", "hidden"),
      control("mood", "Dark", "hidden"),
      control("note", "more live instruments", "declared"),
      control("energy", "low", "boosted"),
    ]);
    expect(isColdStart({ preferences: {}, playedArtistCount: 0, tastePolicy })).toBe(true);
  });

  it("fails open to cold when taste memory is unavailable", () => {
    expect(isColdStart({ preferences: {}, playedArtistCount: 0, tastePolicy: undefined })).toBe(true);
  });
});
