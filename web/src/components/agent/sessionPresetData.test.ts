import { describe, expect, it } from "vitest";
import { listeningRequestFromCrateParse } from "../../../../backend/src/modules/agents/agent_session_request";
import { parseCrateRequestText } from "../../../../backend/src/modules/crates/crate_request_parser";
import { CATALOG_GENRE_OPTIONS, MOOD_TAG_OPTIONS } from "../../lib/catalogVocabulary";
import {
  LEGACY_PRESET_NAMES,
  SESSION_PRESETS,
  SESSION_PROMPT_EXAMPLES,
  plainPresetLabel,
} from "./sessionPresetData";

/**
 * The prompt's sentence is read server-side by the deterministic parser
 * (`POST /agents/config/session/parse`, which runs `parseCrateRequestText`
 * through `listeningRequestFromCrateParse`). Both are pure, so these tests run
 * the very same functions the server does against every starter sentence.
 */
function read(sentence: string) {
  return listeningRequestFromCrateParse(parseCrateRequestText(sentence));
}

const MOMENTS = SESSION_PRESETS.filter((preset) => preset.group === "mood");
const SOUNDS = SESSION_PRESETS.filter((preset) => preset.group === "genre");

describe("session starters", () => {
  it("offers plain names only, with the new moods, and keeps the old intent ids", () => {
    expect(MOMENTS.map((preset) => preset.name)).toEqual([
      "Focus",
      "High energy",
      "Chill",
      "Dark",
      "Calm",
      "Club",
      "Late night",
      "Warm",
    ]);
    const labels = JSON.stringify(SESSION_PRESETS);
    for (const brand of ["Neural Flow", "Pulse Raid", "Liquid Sky", "Abyss Shift", "Static Calm"]) {
      expect(labels).not.toContain(brand);
    }
    for (const intent of ["Focus", "Hype", "Chill", "Dark", "Zen"]) {
      expect(SESSION_PRESETS.map((preset) => preset.intent)).toContain(intent);
    }
    expect(new Set(SESSION_PRESETS.map((preset) => preset.intent)).size).toBe(SESSION_PRESETS.length);
  });

  it("reads every starter sentence with no \"Didn't catch\" text and nothing ignored", () => {
    for (const preset of SESSION_PRESETS) {
      const parsed = read(preset.sentence);
      expect([preset.name, parsed.unparsed]).toEqual([preset.name, []]);
      expect([preset.name, parsed.ignored]).toEqual([preset.name, []]);
    }
  });

  it("shows exactly the chips the sentence reads as", () => {
    for (const preset of SESSION_PRESETS) {
      expect([preset.name, preset.request]).toEqual([preset.name, read(preset.sentence).request]);
    }
  });

  it("never sends a genre filter from a Moments starter", () => {
    expect(MOMENTS.length).toBeGreaterThan(0);
    for (const preset of MOMENTS) {
      expect([preset.name, preset.request.genres]).toEqual([preset.name, []]);
      expect([preset.name, read(preset.sentence).request.genres]).toEqual([preset.name, []]);
      expect([preset.name, preset.searchVibes]).toEqual([preset.name, []]);
      expect([preset.name, preset.preferences.genres ?? []]).toEqual([preset.name, []]);
    }
  });

  it("sets genres only from a Sounds starter, leaving mood and energy to the listener", () => {
    for (const preset of SOUNDS) {
      expect(preset.request.genres.length).toBeGreaterThan(0);
      expect(preset.request.moods).toEqual([]);
      expect(preset.request.energy).toBeNull();
      expect(preset.preferences.genres).toEqual(preset.searchVibes);
      expect(preset.preferences).not.toHaveProperty("mood");
      expect(preset.preferences).not.toHaveProperty("energy");
    }
  });

  it("uses only genres and moods an artist can tag at upload, so every starter can match (#2059)", () => {
    const genres = new Set(CATALOG_GENRE_OPTIONS);
    const moods = new Set(MOOD_TAG_OPTIONS);
    for (const preset of SESSION_PRESETS) {
      for (const genre of preset.searchVibes) expect([preset.name, genres.has(genre)]).toEqual([preset.name, true]);
      if (preset.preferences.mood) expect([preset.name, moods.has(preset.preferences.mood)]).toEqual([preset.name, true]);
    }
  });
});

describe("prompt placeholder examples", () => {
  it("offers several examples", () => {
    expect(SESSION_PROMPT_EXAMPLES.length).toBeGreaterThanOrEqual(3);
  });

  it("reads every example fully, with something to filter on", () => {
    for (const example of SESSION_PROMPT_EXAMPLES) {
      const parsed = read(example);
      expect([example, parsed.unparsed]).toEqual([example, []]);
      expect([example, parsed.ignored]).toEqual([example, []]);
      const { genres, moods, energy, bpm } = parsed.request;
      expect([example, genres.length + moods.length + (energy ? 1 : 0) + (bpm ? 1 : 0) > 0]).toEqual([example, true]);
    }
  });
});

describe("plainPresetLabel", () => {
  it("maps every old intent id and brand name to its plain label", () => {
    expect(Object.fromEntries(LEGACY_PRESET_NAMES)).toMatchObject({
      Focus: "Focus",
      Hype: "High energy",
      Chill: "Chill",
      Dark: "Dark",
      Zen: "Calm",
      "Neural Flow": "Focus",
      "Pulse Raid": "High energy",
      "Liquid Sky": "Chill",
      "Abyss Shift": "Dark",
      "Static Calm": "Calm",
    });
  });

  it("leaves names that never changed alone", () => {
    expect(plainPresetLabel("Afrobeats & Amapiano")).toBe("Afrobeats & Amapiano");
    expect(plainPresetLabel("Something else")).toBe("Something else");
  });

  it("gives every current starter's intent id a label that is its own name", () => {
    for (const preset of SESSION_PRESETS) {
      const legacy = plainPresetLabel(preset.intent);
      if (legacy !== preset.intent) expect([preset.intent, legacy]).toEqual([preset.intent, preset.name]);
    }
  });
});
