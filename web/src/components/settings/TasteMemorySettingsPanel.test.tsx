import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTasteMemory as resetTasteMemoryApi, type TasteMemoryResponse } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getTasteMemory: vi.fn(),
  removeTasteSignalControl: vi.fn(),
  resetTasteMemory: vi.fn(),
  updateTasteMemorySettings: vi.fn(),
  upsertTasteSignalControl: vi.fn(),
  applyTasteEdits: vi.fn(),
  previewTasteEdits: vi.fn(),
}));
vi.mock("../../lib/productAnalytics", () => ({ recordProductAnalytics: vi.fn() }));

import TasteMemorySettingsPanel, {
  resetTasteMemoryState,
  TasteMemorySummary,
} from "./TasteMemorySettingsPanel";

const settings: TasteMemoryResponse["settings"] = {
  socialMatchingEnabled: false,
  citySceneDiscoveryEnabled: false,
  agentPlaybackTrainingEnabled: true,
  recommendationExplanationPreference: "balanced",
  resetAt: null,
};

const legacySummary: TasteMemoryResponse["summary"] = {
  favoredGenres: ["Soul"],
  favoredMoods: ["Warm"],
  favoredArtists: ["Felicia Angels"],
  recentIntents: [],
  noveltyPattern: "Balanced discovery",
  commercePreference: "Listening first",
  explanationPreference: "balanced",
};

function memory(summary: TasteMemoryResponse["summary"] = legacySummary): TasteMemoryResponse {
  return {
    schemaVersion: "listener-taste-memory/v1",
    settings,
    summary,
    controls: [],
    privacy: {
      socialMatching: "disabled",
      citySceneDiscovery: "disabled",
      agentPlaybackTraining: "enabled",
      notes: [],
    },
  };
}

describe("TasteMemorySettingsPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a legacy response without optional energy, tempo, or context fields", () => {
    const html = renderToStaticMarkup(<TasteMemorySummary summary={legacySummary} />);

    expect(html).toContain("Soul");
    expect(html).toContain("Warm");
    expect(html).toContain("Felicia Angels");
    expect(html).toContain("Energy");
    expect(html).toContain("Tempo");
    expect(html.match(/Not enough signal yet/g)).toHaveLength(3);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("<span>Evenings · weekdays</span>");
  });

  it("renders plain energy and tempo labels with bounded context summaries", () => {
    const contexts = Array.from({ length: 9 }, (_, index) => ({
      localHourBucket: index === 8 ? "morning" as const : "evening" as const,
      weekdayKind: index === 8 ? "weekend" as const : "weekday" as const,
      favoredGenres: index === 0 ? ["Genre 1", "Genre 2", "Genre 3", "Genre 4", "Genre 5", "Hidden genre"] : ["Soul"],
      favoredMoods: index === 0 ? ["Mood 1", "Mood 2", "Mood 3", "Mood 4", "Mood 5", "Hidden mood"] : ["Warm"],
    }));
    const html = renderToStaticMarkup(
      <TasteMemorySummary
        summary={{
          ...legacySummary,
          favoredEnergyBands: ["low", "high"],
          favoredTempoBands: ["slow", "mid", "fast"],
          contexts,
        }}
      />,
    );

    expect(html).toContain("Low, High");
    expect(html).toContain("Slow, Medium, Fast");
    expect(html).toContain("Evenings · weekdays");
    expect(html).toContain("Genres: Genre 1, Genre 2, Genre 3, Genre 4, Genre 5");
    expect(html).toContain("Moods: Mood 1, Mood 2, Mood 3, Mood 4, Mood 5");
    expect(html).not.toContain("Hidden genre");
    expect(html).not.toContain("Hidden mood");
    expect(html).not.toContain("Mornings · weekends");
  });

  it("clears every taste dimension after the mocked reset API succeeds", async () => {
    const populatedMemory = memory({
      ...legacySummary,
      favoredEnergyBands: ["low"],
      favoredTempoBands: ["mid"],
      contexts: [{
        localHourBucket: "evening",
        weekdayKind: "weekday",
        favoredGenres: ["Soul"],
        favoredMoods: ["Warm"],
      }],
    });
    const resetSettings = { ...settings, resetAt: "2026-10-03T10:00:00.000Z" };
    vi.mocked(resetTasteMemoryApi).mockResolvedValueOnce(resetSettings);
    const setMemory = vi.fn();

    const updatedMemory = await resetTasteMemoryState({
      token: "listener-token",
      memory: populatedMemory,
      setMemory,
    });

    expect(resetTasteMemoryApi).toHaveBeenCalledWith("listener-token");
    expect(setMemory).toHaveBeenCalledWith(updatedMemory);
    expect(updatedMemory.settings).toEqual(resetSettings);
    expect(updatedMemory.summary).toMatchObject({
      favoredGenres: [],
      favoredMoods: [],
      favoredArtists: [],
      favoredEnergyBands: [],
      favoredTempoBands: [],
      contexts: [],
      recentIntents: [],
      noveltyPattern: "Balanced discovery",
      commercePreference: "Listening first",
    });
  });

  it("keeps the training toggle label and explains playback and library learning consent", () => {
    const html = renderToStaticMarkup(
      <TasteMemorySettingsPanel token={null} addToast={vi.fn()} />,
    );

    expect(html).toContain("AI DJ playback trains taste");
    expect(html).toContain("Let your playback and library activity shape taste when analytics consent is enabled.");
  });
});
