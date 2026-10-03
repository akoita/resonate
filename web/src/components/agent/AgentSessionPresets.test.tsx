import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentSessionPresets, { SESSION_PRESETS } from "./AgentSessionPresets";
import { CATALOG_GENRE_OPTIONS, MOOD_TAG_OPTIONS } from "../../lib/catalogVocabulary";

describe("AgentSessionPresets", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders compact session intent cards without decorative orb copy", () => {
    const html = renderToStaticMarkup(<AgentSessionPresets compact />);

    expect(html).toContain("AI DJ Session Intent");
    expect(html).toContain("Tell the DJ what this session is for.");
    expect(html).toContain("Go to your AI DJ");
    expect(html).toContain('href="/#ai-dj"');
    expect(html).not.toContain('href="/agent"');
    expect(html).not.toContain("mystery orb");
    expect(html.match(/<article/g)?.length).toBe(SESSION_PRESETS.length);
  });

  it("marks the selected intent and exposes start actions when wired", () => {
    const html = renderToStaticMarkup(
      <AgentSessionPresets
        selectedIntent="Hype"
        showOpenLink={false}
        onSelect={() => {}}
        onStart={() => {}}
      />,
    );

    expect(html).toContain("agent-session-card selected");
    expect(html).toContain("Start with this");
    expect(html).not.toContain("Buy-ready stems");
    expect(html).not.toContain("Go to your AI DJ");
  });

  it("never exposes stem buying on any preset", () => {
    const html = renderToStaticMarkup(<AgentSessionPresets />);

    expect(html).not.toContain("Buy-ready");
    expect(html).not.toContain("Licensing posture");
    for (const preset of SESSION_PRESETS) {
      expect(preset).not.toHaveProperty("commercePosture");
      expect(JSON.stringify(preset)).not.toMatch(/"buy"/i);
    }
  });

  it("shows no tempo target and carries no license tier on any preset (#2036)", () => {
    const html = renderToStaticMarkup(<AgentSessionPresets />);

    expect(html).not.toContain("Tempo target");
    expect(html).not.toMatch(/\bBPM\b/);
    for (const preset of SESSION_PRESETS) {
      expect(preset).not.toHaveProperty("tempo");
      expect(preset.preferences).not.toHaveProperty("licenseType");
    }
  });

  it("uses only genres and moods an artist can tag at upload, so every preset can match (#2059)", () => {
    const genres = new Set(CATALOG_GENRE_OPTIONS);
    const moods = new Set(MOOD_TAG_OPTIONS);
    for (const preset of SESSION_PRESETS) {
      for (const genre of preset.searchVibes) expect([preset.name, genres.has(genre)]).toEqual([preset.name, true]);
      expect(preset.preferences.genres).toEqual(preset.searchVibes);
      if (preset.preferences.mood) {
        expect([preset.name, moods.has(preset.preferences.mood)]).toEqual([preset.name, true]);
      }
    }
  });
});
