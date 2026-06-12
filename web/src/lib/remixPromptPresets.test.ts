import { describe, expect, it } from "vitest";
import {
  activePresetLabel,
  presetsForMode,
  REMIX_PROMPT_PRESETS,
} from "./remixPromptPresets";

describe("REMIX_PROMPT_PRESETS (#1177)", () => {
  it("covers both prompted modes with non-empty, distinct presets", () => {
    for (const mode of ["variation", "extension"] as const) {
      const presets = REMIX_PROMPT_PRESETS[mode];
      expect(presets.length).toBeGreaterThanOrEqual(3);
      const labels = new Set(presets.map((p) => p.label));
      expect(labels.size).toBe(presets.length);
      for (const preset of presets) {
        expect(preset.label.trim()).not.toBe("");
        expect(preset.prompt.trim().length).toBeGreaterThan(20);
      }
    }
  });

  it("describes the sound without duplicating the provider's mode boilerplate", () => {
    // buildLyriaRemixPrompt prepends these phrasings; presets must not
    // repeat them or the final prompt reads doubled.
    const boilerplate = [
      "variation of the source arrangement",
      "extend the source arrangement",
      "create a reinterpreted",
    ];
    for (const presets of Object.values(REMIX_PROMPT_PRESETS)) {
      for (const preset of presets) {
        const lower = preset.prompt.toLowerCase();
        for (const phrase of boilerplate) {
          expect(lower).not.toContain(phrase);
        }
      }
    }
  });
});

describe("presetsForMode", () => {
  it("returns presets only for prompted modes", () => {
    expect(presetsForMode("variation").length).toBeGreaterThan(0);
    expect(presetsForMode("extension").length).toBeGreaterThan(0);
    expect(presetsForMode("stem_mix")).toEqual([]);
    expect(presetsForMode("anything_else")).toEqual([]);
  });
});

describe("activePresetLabel", () => {
  it("matches the preset whose text the prompt currently holds", () => {
    const preset = REMIX_PROMPT_PRESETS.variation[0];
    expect(activePresetLabel("variation", preset.prompt)).toBe(preset.label);
    expect(activePresetLabel("variation", `  ${preset.prompt}  `)).toBe(preset.label);
  });

  it("returns null for edited, empty, or cross-mode prompts", () => {
    const preset = REMIX_PROMPT_PRESETS.variation[0];
    expect(activePresetLabel("variation", preset.prompt + " but faster")).toBeNull();
    expect(activePresetLabel("variation", "")).toBeNull();
    expect(activePresetLabel("extension", preset.prompt)).toBeNull();
  });
});
