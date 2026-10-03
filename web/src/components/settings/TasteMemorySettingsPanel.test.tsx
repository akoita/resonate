import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetTasteMemory as resetTasteMemoryApi,
  type ListeningLane,
  type TasteMemoryResponse,
  type TasteSignalControl,
} from "../../lib/api";

vi.mock("../../lib/api", () => ({
  DECLARED_TEXT_EDIT_SOURCE: "declared_text_edit",
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
  filterGenericTasteControls,
  ListeningLaneSection,
  resetTasteMemoryState,
  TasteSignalControlList,
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

const laneId = "lane_0123456789abcdef0123456789abcdef";
const listeningLane: ListeningLane = {
  id: laneId,
  label: "Soul · Warm",
  genreWeights: { Soul: 0.8 },
  moodWeights: { Warm: 0.7 },
  strength: 0.9,
  contexts: {
    "night:weekend": 0.3,
    "evening:weekday": 0.8,
  },
  energyBand: "medium",
  hidden: true,
};

const laneControl: TasteSignalControl = {
  id: "control-hidden-lane",
  signalType: "lane",
  value: laneId,
  action: "hidden",
  source: "settings",
  createdAt: "2026-10-03T10:00:00.000Z",
};

const declaredControl: TasteSignalControl = {
  id: "control-declared-jazz",
  signalType: "genre",
  value: "Jazz",
  action: "boosted",
  source: "declared_text_edit",
  createdAt: "2026-10-03T10:00:00.000Z",
};

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

  it("renders lane catalog labels and coarse context without exposing opaque IDs", () => {
    const html = renderToStaticMarkup(
      <ListeningLaneSection
        lanes={[listeningLane]}
        controls={[laneControl]}
        saving={false}
        onHide={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(html).toContain("Your listening lanes");
    expect(html).toContain("Soul · Warm");
    expect(html).toContain("Weekday evenings");
    expect(html).toContain("Weekend nights");
    expect(html).toContain("Typical energy: Medium");
    expect(html).toContain("Restore to mixes");
    expect(html).toContain("future mixes");
    expect(html).not.toContain(laneId);
  });

  it("shows repeated-session guidance when no lanes have been learned", () => {
    const html = renderToStaticMarkup(
      <ListeningLaneSection lanes={[]} controls={[]} saving={false} onHide={vi.fn()} onRestore={vi.fn()} />,
    );

    expect(html).toContain("Repeated listening sessions are needed");
    expect(html).toContain("Mixes are not available yet");
  });

  it("keeps lane controls out of the generic editor and gives orphan hides a safe restore row", () => {
    const orphanId = "lane_fedcba9876543210fedcba9876543210";
    const orphanControl = { ...laneControl, id: "orphan-lane-control", value: orphanId };
    const controls = [laneControl, orphanControl, declaredControl];
    const visibleControls = filterGenericTasteControls(controls, [listeningLane]);
    const html = renderToStaticMarkup(
      <TasteSignalControlList controls={visibleControls} savingKey={null} onRestore={vi.fn()} />,
    );

    expect(visibleControls).toEqual([orphanControl, declaredControl]);
    expect(html).toContain("Hidden listening lane");
    expect(html).toContain('aria-label="Restore hidden listening lane"');
    expect(html).toContain("Jazz");
    expect(html).not.toContain(laneId);
    expect(html).not.toContain(orphanId);
  });

  it("clears every taste dimension after the mocked reset API succeeds", async () => {
    const populatedSummary: TasteMemoryResponse["summary"] = {
      ...legacySummary,
      favoredEnergyBands: ["low"],
      favoredTempoBands: ["mid"],
      contexts: [{
        localHourBucket: "evening",
        weekdayKind: "weekday",
        favoredGenres: ["Soul"],
        favoredMoods: ["Warm"],
      }],
      listeningLanes: [listeningLane],
    };
    const populatedMemory: TasteMemoryResponse = {
      ...memory(populatedSummary),
      controls: [declaredControl, laneControl],
    };
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
      listeningLanes: [],
      recentIntents: [],
      noveltyPattern: "Balanced discovery",
      commercePreference: "Listening first",
    });
    expect(updatedMemory.controls).toEqual([declaredControl]);
  });

  it("keeps the training toggle label and explains playback and library learning consent", () => {
    const html = renderToStaticMarkup(
      <TasteMemorySettingsPanel token={null} addToast={vi.fn()} />,
    );

    expect(html).toContain("AI DJ playback trains taste");
    expect(html).toContain("Let your playback and library activity shape taste when analytics consent is enabled.");
  });
});
