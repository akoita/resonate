import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentMixVocabulary, AgentSessionRequest, ListeningLane } from "../../lib/api";
import AgentSessionPrompt from "./AgentSessionPrompt";
import { SESSION_PRESETS } from "./AgentSessionPresets";

const request: AgentSessionRequest = {
  genres: ["deep house"],
  moods: ["warm"],
  energy: "medium",
  bpm: { min: 120, max: 125 },
};
const myMixLane: ListeningLane = {
  id: "lane_private_0123456789abcdef0123456789abcdef",
  label: "Soul · Warm",
  genreWeights: { Soul: 0.8 },
  moodWeights: { Warm: 0.7 },
  strength: 0.9,
  contexts: {},
  energyBand: null,
  hidden: false,
};
const vocabulary: AgentMixVocabulary = { genres: ["Dancehall"], moods: ["Zen"] };

function render(props: Partial<React.ComponentProps<typeof AgentSessionPrompt>> = {}) {
  return renderToStaticMarkup(
    <AgentSessionPrompt
      text=""
      onTextChange={vi.fn()}
      onSelectPreset={vi.fn()}
      request={null}
      onRemoveChip={vi.fn()}
      onEnergyChange={vi.fn()}
      onSubmit={vi.fn()}
      {...props}
    />,
  );
}

describe("AgentSessionPrompt", () => {
  it("asks what the session is for with a limited textarea and an example", () => {
    const html = render();
    expect(html).toContain("What&#x27;s this session for?");
    expect(html).toContain("<textarea");
    expect(html).toContain('maxLength="500"');
    expect(html).toContain("Warm deep house around 122 BPM for cooking");
    expect(html).toContain("not saved");
    expect(html).toContain("Start session");
    expect(html).toContain("No filters yet");
  });

  it("offers an accessible include-explicit-tracks toggle that reflects the saved choice (#2088)", () => {
    expect(render()).not.toContain("Include explicit tracks");

    const off = render({ explicit: { enabled: false, onChange: vi.fn() } });
    expect(off).toContain("Include explicit tracks");
    expect(off).toContain("Applies from the next pick.");
    expect(off).toMatch(/<input[^>]*type="checkbox"/);
    expect(off).not.toMatch(/<input[^>]*checked=""/);
    expect(off).toMatch(/<label[^>]*for="[^"]*-explicit"/);

    const on = render({ explicit: { enabled: true, onChange: vi.fn() } });
    expect(on).toMatch(/<input[^>]*checked=""/);
  });

  it("disables the toggle while saving and shows a save error inline (#2088)", () => {
    const html = render({ explicit: { enabled: true, isSaving: true, error: "Couldn't save this setting.", onChange: vi.fn() } });
    expect(html).toMatch(/<input[^>]*disabled=""/);
    expect(html).toContain("Couldn&#x27;t save this setting.");
  });

  it("shows every preset as a quick-start chip and marks the active one", () => {
    const html = render({ activePresetIntent: "Hype" });
    const escape = (value: string) => value.replace(/&/g, "&amp;");
    for (const preset of SESSION_PRESETS) expect(html).toContain(escape(preset.name));
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(SESSION_PRESETS.length - 1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Pulse Raid</);
  });

  it("offers everyday genre presets before the mood presets (#2052)", () => {
    const html = render();
    const genres = SESSION_PRESETS.filter((preset) => preset.group === "genre");
    expect(genres.length).toBeGreaterThanOrEqual(6);
    expect(html).toContain(">Genres<");
    expect(html).toContain(">Moods<");
    expect(html.indexOf(">Genres<")).toBeLessThan(html.indexOf(">Moods<"));
    expect(html.indexOf("Hip-Hop &amp; Rap")).toBeLessThan(html.indexOf("Neural Flow"));
  });

  it("puts My Mix before ordinary presets only when a visible lane is available", () => {
    const myMix = {
      lanes: [myMixLane],
      vocabulary,
      preferences: { context: "evening:weekday" as const },
      onSelect: vi.fn(),
      onChange: vi.fn(),
      onSave: vi.fn(),
    };
    const html = render({ myMix });
    expect(html.indexOf(">My Mix</button>")).toBeLessThan(html.indexOf(">Genres<"));
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Add a genre or mood");
    expect(html).not.toContain(myMixLane.id);

    const hidden = render({ myMix: { ...myMix, lanes: [{ ...myMixLane, hidden: true }] } });
    expect(hidden).not.toContain(">My Mix</button>");
  });

  it("describes the selected preset and what it sounds like, visibly (#2052)", () => {
    const html = render({ activePresetIntent: "R&B" });
    const about = html.slice(html.indexOf('data-testid="agent-session-preset-about"'));
    expect(about).toContain("R&amp;B &amp; Soul.");
    expect(about).toContain("Smooth vocals and slow grooves");
    expect(about).toContain("You&#x27;ll hear: Silky singing over warm, laid-back grooves.");
  });

  it("invites a choice when no preset is selected", () => {
    const html = render();
    expect(html).not.toContain('data-testid="agent-session-preset-about"');
    expect(html).toContain("Pick a quick start to see what it sounds like");
  });

  it("gives every chip a screen-reader description outside its accessible name", () => {
    const html = render();
    const describedBy = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1]);
    expect(describedBy).toHaveLength(SESSION_PRESETS.length);
    expect(new Set(describedBy).size).toBe(SESSION_PRESETS.length);
    for (const id of describedBy) expect(html).toContain(`id="${id}"`);
    // The chip's own text stays just the preset name.
    expect(html).toMatch(/aria-describedby="[^"]+">Neural Flow<\/button>/);
  });

  it("renders each parsed filter as a removable chip and energy as a select", () => {
    const html = render({ request });
    expect(html).toContain("Deep house");
    expect(html).toContain("Warm mood");
    expect(html).toContain("120–125 BPM");
    expect(html).toContain('aria-label="Remove filter Deep house"');
    expect(html).toContain('aria-label="Remove filter Warm mood"');
    expect(html).toContain('aria-label="Remove filter Medium energy"');
    expect(html).toContain('aria-label="Remove filter 120–125 BPM"');
    expect(html).toContain("<select");
    expect(html).toMatch(/<option value="medium" selected="">medium<\/option>/);
    expect(html).toContain('<option value="low">low</option>');
    expect(html).toContain('<option value="high">high</option>');
    expect(html).not.toContain("No filters yet");
  });

  it("lists phrases it did not catch and filters not used for listening", () => {
    const html = render({
      request,
      unparsed: ["for cooking", "with feeling"],
      ignored: ["keys", "maxTotalUsd", "maxPerItemUsd", "verifiedHumanOnly"],
    });
    expect(html).toContain("Didn&#x27;t catch: “for cooking”, “with feeling”");
    expect(html).toContain("Not used for listening: key, price, verified human only");
  });

  it("omits the notes when there is nothing to say", () => {
    const html = render({ request });
    expect(html).not.toContain("Didn&#x27;t catch");
    expect(html).not.toContain("Not used for listening");
  });

  it("explains coverage gaps in the request's own words", () => {
    const html = render({
      request,
      coverage: { picks: 5, gaps: [{ filter: "bpm", matched: 1 }] },
    });
    expect(html).toContain("Only 1 of 5 picks matched 120–125 BPM");
  });

  it("shows the reading and error states and blocks the action while reading", () => {
    const reading = render({ isParsing: true });
    expect(reading).toContain("Reading what you wrote");
    expect(reading).toMatch(/<button[^>]*disabled=""[^>]*>Reading…<\/button>/);

    const failed = render({ request, parseError: "Couldn't read that just now. Your filters are unchanged." });
    expect(failed).toContain("Couldn&#x27;t read that just now");
    expect(failed).toContain("Deep house");
  });

  it("offers Update session while a session is live", () => {
    expect(render({ isLive: true })).toContain("Update session");
    expect(render({ isLive: true, isBusy: true })).toContain("Updating…");
    expect(render({ isBusy: true })).toContain("Starting…");
  });
});
