import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentMixVocabulary, AgentSessionRequest, ListeningLane } from "../../lib/api";
import AgentSessionPrompt from "./AgentSessionPrompt";
import { SESSION_PRESETS, SESSION_PROMPT_EXAMPLES } from "./sessionPresetData";

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
    // The placeholder is a real example the parser fully reads.
    expect(html).toContain(`placeholder="${SESSION_PROMPT_EXAMPLES[0]}"`);
    expect(html).toContain("not saved");
    expect(html).toContain("Start session");
    // No saved vibes are known yet, so no starting-taste line.
    expect(html).not.toContain("your DJ starts from");
  });

  it("labels the DJ's starting taste in the empty state and links to where it is edited (#2239)", () => {
    const html = render({ savedVibes: ["Chill", "Deep House", "Lo-fi", "Jazz"] });
    expect(html).toContain("With no filters, your DJ starts from:");
    expect(html).toContain("<strong>Chill, Deep House, Lo-fi…</strong>");
    expect(html).toMatch(/<a[^>]*href="\/settings\?section=dj"[^>]*>Edit<\/a>/);
  });

  it("lists every saved vibe without an ellipsis when there are only a few", () => {
    const html = render({ savedVibes: ["Chill", "Deep House"] });
    expect(html).toContain("<strong>Chill, Deep House</strong>");
    expect(html).not.toContain("…</strong>");
  });

  it("offers a way to set vibes when the DJ has none", () => {
    const html = render({ savedVibes: [] });
    expect(html).toContain("No saved vibes");
    expect(html).toMatch(/<a[^>]*href="\/settings\?section=dj"[^>]*>Set them<\/a>/);
    expect(html).not.toContain("your DJ starts from");
  });

  it("hides the starting-taste line once filters exist", () => {
    expect(render({ savedVibes: ["Chill"], request })).not.toContain("your DJ starts from");
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

  it("shows every starter as a button and announces which one is pressed", () => {
    const html = render({ activePresetIntent: "Hype" });
    const escape = (value: string) => value.replace(/&/g, "&amp;");
    for (const preset of SESSION_PRESETS) expect(html).toContain(escape(preset.name));
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(SESSION_PRESETS.length - 1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>High energy</);
    // No brand names are left in the UI.
    for (const brand of ["Neural Flow", "Pulse Raid", "Liquid Sky", "Abyss Shift", "Static Calm"]) {
      expect(html).not.toContain(brand);
    }
  });

  it("lays the starters out as labelled Moments and Sounds rows, Moments first (#2249)", () => {
    const html = render();
    expect(html).toContain(">Moments<");
    expect(html).toContain(">Sounds<");
    expect(html).not.toContain(">Genres<");
    expect(html).not.toContain(">Moods<");
    expect(html.indexOf(">Moments<")).toBeLessThan(html.indexOf(">Sounds<"));
    expect(html.indexOf(">Late night<")).toBeLessThan(html.indexOf(">Sounds<"));
    expect(html.indexOf(">Sounds<")).toBeLessThan(html.indexOf("Hip-Hop &amp; Rap"));
    // Each row is a group named by its visible label.
    for (const label of ["Moments", "Sounds"]) {
      const labelId = html.match(new RegExp(`<span id="([^"]+)"[^>]*>${label}</span>`))?.[1];
      expect(labelId).toBeTruthy();
      expect(html).toContain(`role="group" aria-labelledby="${labelId}"`);
    }
    // The Moments row offers the new moods too.
    for (const name of ["Focus", "High energy", "Chill", "Dark", "Calm", "Club", "Late night", "Warm"]) {
      expect(html).toContain(`>${name}</button>`);
    }
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
    expect(html).toContain(">For you<");
    expect(html.indexOf(">My Mix</button>")).toBeLessThan(html.indexOf(">Moments<"));
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Add a genre or mood");
    expect(html).not.toContain(myMixLane.id);

    const hidden = render({ myMix: { ...myMix, lanes: [{ ...myMixLane, hidden: true }] } });
    expect(hidden).not.toContain(">My Mix</button>");
    // Absent items are omitted, not shown broken: no "For you" row without lanes.
    expect(hidden).not.toContain(">For you<");
    expect(render()).not.toContain(">For you<");
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
    expect(html).toContain("Pick a starter to see what it sounds like");
  });

  it("gives every chip a screen-reader description outside its accessible name", () => {
    const html = render();
    const describedBy = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1]);
    expect(describedBy).toHaveLength(SESSION_PRESETS.length);
    expect(new Set(describedBy).size).toBe(SESSION_PRESETS.length);
    for (const id of describedBy) expect(html).toContain(`id="${id}"`);
    // The chip's own text stays just the preset name.
    expect(html).toMatch(/aria-describedby="[^"]+">High energy<\/button>/);
  });

  it("renders each parsed filter as a removable chip", () => {
    const html = render({ request });
    expect(html).toContain("Deep house");
    expect(html).toContain("Warm mood");
    expect(html).toContain("120–125 BPM");
    expect(html).toContain('aria-label="Remove filter Deep house"');
    expect(html).toContain('aria-label="Remove filter Warm mood"');
    expect(html).toContain('aria-label="Remove filter Medium energy"');
    expect(html).toContain('aria-label="Remove filter 120–125 BPM"');
    expect(html).not.toContain("your DJ starts from");
  });

  describe("Adjust row of optional filters (#2249)", () => {
    it("is a labelled group with Energy and the explicit choice together", () => {
      const html = render({ request, explicit: { enabled: false, onChange: vi.fn() } });
      const adjust = html.slice(html.indexOf('data-testid="agent-session-adjust"'));
      expect(adjust).toContain(">Adjust<");
      expect(adjust).toMatch(/role="group" aria-labelledby="[^"]*-adjust"/);
      expect(adjust).toMatch(/<label[^>]*for="[^"]*-energy"[^>]*>Energy<\/label>/);
      expect(adjust).toContain("Include explicit tracks");
      // The explicit checkbox moved into the Adjust row: nothing renders it above it.
      expect(html.indexOf("Include explicit tracks")).toBeGreaterThan(html.indexOf('data-testid="agent-session-adjust"'));
      expect(html.match(/Include explicit tracks/g)).toHaveLength(1);
    });

    it("announces the current energy and offers Any, Low, Medium and High", () => {
      const withEnergy = render({ request });
      expect(withEnergy).toMatch(/<option value="medium" selected="">Medium<\/option>/);
      expect(withEnergy).toContain('<option value="">Any (the DJ decides)</option>');
      expect(withEnergy).toContain('<option value="low">Low</option>');
      expect(withEnergy).toContain('<option value="high">High</option>');

      const none = render({ request: { ...request, energy: null } });
      expect(none).toMatch(/<option value="" selected="">Any \(the DJ decides\)<\/option>/);
      expect(render()).toMatch(/<option value="" selected="">Any/);
    });

    it("hides Energy while My Mix is chosen, since My Mix follows listening lanes", () => {
      const html = render({
        myMix: {
          lanes: [myMixLane],
          vocabulary,
          preferences: { context: "evening:weekday" as const },
          onSelect: vi.fn(),
          onChange: vi.fn(),
          onSave: vi.fn(),
        },
      });
      expect(html).toContain(">Adjust<");
      expect(html).not.toMatch(/<label[^>]*for="[^"]*-energy"/);
    });
  });

  it("rotates the placeholder through examples only while the box is empty", () => {
    expect(SESSION_PROMPT_EXAMPLES.length).toBeGreaterThan(1);
    expect(render()).toContain(`placeholder="${SESSION_PROMPT_EXAMPLES[0]}"`);
    expect(render({ text: "Club" })).not.toContain('placeholder="Club"');
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

  describe("request coverage line (#2238)", () => {
    const coverageText = (html: string) =>
      html.match(/data-testid="agent-session-coverage">([^<]*)</)?.[1] ?? null;

    it("says every pick matched when nothing fell short", () => {
      const html = render({ request, coverage: { picks: 5, gaps: [] } });
      expect(coverageText(html)).toBe("All picks matched your request");
      expect(html).toContain("aid-prompt-note--coverage-full");
    });

    it("explains a partial match in the request's own words, once", () => {
      const html = render({ request, coverage: { picks: 5, gaps: [{ filter: "bpm", matched: 1 }] } });
      expect(coverageText(html)).toBe("Only 1 of 5 picks matched 120–125 BPM");
      expect(html.match(/agent-session-coverage/g)).toHaveLength(1);
      expect(html).toContain("aid-prompt-note--coverage-partial");
    });

    it("is honest when nothing in the catalog matched", () => {
      const html = render({
        request: { genres: ["World"], moods: [], energy: null, bpm: null },
        coverage: { picks: 5, gaps: [{ filter: "genres", matched: 0 }] },
      });
      expect(coverageText(html)).toBe("Nothing in the catalog matched World yet \u2014 playing the closest picks");
      expect(html).toContain("aid-prompt-note--coverage-none");
    });

    it("shows nothing without coverage or without filters", () => {
      expect(render({ request })).not.toContain("agent-session-coverage");
      expect(render({ coverage: { picks: 5, gaps: [] } })).not.toContain("agent-session-coverage");
    });

    it("sits right under the filter chips", () => {
      const html = render({ request, coverage: { picks: 5, gaps: [] } });
      expect(html.indexOf("Session filters")).toBeLessThan(html.indexOf("agent-session-coverage"));
    });
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

  it("shows a named artist as a removable Like chip beside the filter chips (#2241)", () => {
    const html = render({ request, artists: ["Nadia Okoro"] });
    expect(html).toContain("Like: Nadia Okoro");
    expect(html).toContain('aria-label="Remove filter Like: Nadia Okoro"');
    expect(html.indexOf("Like: Nadia Okoro")).toBeLessThan(html.indexOf("Deep house"));
    expect(render({ request })).not.toContain("Like:");
  });

  it("keeps an unknown name under Didn't catch", () => {
    expect(render({ unparsed: ["Zed Nonexistent"] })).toContain("Zed Nonexistent");
  });
});
