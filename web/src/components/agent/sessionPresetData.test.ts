import { describe, expect, it } from "vitest";
import { listeningRequestFromCrateParse } from "../../../../backend/src/modules/agents/agent_session_request";
import { parseCrateRequestText } from "../../../../backend/src/modules/crates/crate_request_parser";
import { CATALOG_GENRE_OPTIONS, MOOD_TAG_OPTIONS } from "../../lib/catalogVocabulary";
import {
  DEFAULT_SOUNDS_MIN_TRACKS,
  EXTRA_SOUND_PRESETS,
  LEGACY_PRESET_NAMES,
  SESSION_PRESETS,
  SESSION_PROMPT_EXAMPLES,
  newArtistsPresetFor,
  plainPresetLabel,
  soundCountLabel,
  soundPresetsForFamilies,
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

describe("catalog-aware Sounds (#2249)", () => {
  const familyCounts = (count: number) =>
    [...SESSION_PRESETS, ...EXTRA_SOUND_PRESETS]
      .filter((preset) => preset.familyId)
      .map((preset) => ({ id: preset.familyId!, label: preset.name, count }));

  it("buckets counts: exact under 10, then 10+, 20+, 40+", () => {
    expect([0, 3, 9].map(soundCountLabel)).toEqual(["0", "3", "9"]);
    expect([10, 19].map(soundCountLabel)).toEqual(["10+", "10+"]);
    expect([20, 39].map(soundCountLabel)).toEqual(["20+", "20+"]);
    expect([40, 41, 5000].map(soundCountLabel)).toEqual(["40+", "40+", "40+"]);
  });

  it("keeps the order the backend returned", () => {
    const { presets } = soundPresetsForFamilies([
      { id: "world", label: "World", count: 50 },
      { id: "jazz", label: "Jazz", count: 4 },
      { id: "hip-hop", label: "Hip-Hop", count: 9 },
    ]);
    expect(presets.map((preset) => preset.intent)).toEqual(["World", "Jazz", "Hip-Hop"]);
  });

  it("shows no Sounds starter below the minimum playable-track threshold", () => {
    const families = [
      { id: "world", label: "World", count: DEFAULT_SOUNDS_MIN_TRACKS },
      { id: "jazz", label: "Jazz", count: DEFAULT_SOUNDS_MIN_TRACKS - 1 },
      { id: "hip-hop", label: "Hip-Hop", count: 0 },
    ];
    const { presets, counts } = soundPresetsForFamilies(families);
    expect(presets.map((preset) => preset.intent)).toEqual(["World"]);
    expect(counts).toEqual({ World: DEFAULT_SOUNDS_MIN_TRACKS });
    // The backend's own threshold wins when it sends one.
    expect(soundPresetsForFamilies(families, 1).presets.map((preset) => preset.intent)).toEqual([
      "World",
      "Jazz",
    ]);
  });

  describe("New artists in <family> (#2249)", () => {
    const families = [
      { id: "jazz", label: "Jazz", count: 12 },
      { id: "world", label: "World", count: 2 },
      { id: "african", label: "African", count: 99 },
    ];

    it("uses the starter of the listener's top family", () => {
      expect(newArtistsPresetFor("jazz", families)?.intent).toBe("Jazz");
    });

    it("is hidden without a top family, when the catalog cannot fill it, or when it has no starter", () => {
      expect(newArtistsPresetFor(undefined, families)).toBeNull();
      expect(newArtistsPresetFor("rock", families)).toBeNull();
      expect(newArtistsPresetFor("world", families)).toBeNull();
      expect(newArtistsPresetFor("african", families)).toBeNull();
      expect(newArtistsPresetFor("jazz", [])).toBeNull();
    });
  });

  it("leaves out families that have no starter instead of inventing one", () => {
    const { presets } = soundPresetsForFamilies([
      { id: "african", label: "African", count: 99 },
      { id: "not-a-family", label: "Nope", count: 99 },
    ]);
    expect(presets).toEqual([]);
  });

  it("generates only starters whose sentence the parser reads with nothing left over", () => {
    const { presets } = soundPresetsForFamilies(familyCounts(100));
    expect(presets.length).toBeGreaterThanOrEqual(SESSION_PRESETS.filter((preset) => preset.group === "genre").length);
    for (const preset of presets) {
      expect(preset.group).toBe("genre");
      const parsed = read(preset.sentence);
      expect([preset.name, parsed.unparsed]).toEqual([preset.name, []]);
      expect([preset.name, parsed.ignored]).toEqual([preset.name, []]);
      expect([preset.name, preset.request]).toEqual([preset.name, parsed.request]);
      expect(preset.request.genres.length).toBeGreaterThan(0);
      for (const genre of preset.searchVibes) expect(CATALOG_GENRE_OPTIONS).toContain(genre);
    }
  });

  it("gives every extra Sounds starter a unique intent and family", () => {
    const all = [...SESSION_PRESETS, ...EXTRA_SOUND_PRESETS];
    expect(new Set(all.map((preset) => preset.intent)).size).toBe(all.length);
    const families = all.filter((preset) => preset.familyId).map((preset) => preset.familyId);
    expect(new Set(families).size).toBe(families.length);
  });
});
