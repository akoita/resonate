import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentMixVocabulary, AgentRightNow, AgentSessionRequest, ListeningLane } from "../../lib/api";
import AgentSessionPrompt from "./AgentSessionPrompt";
import { SESSION_PRESETS, SESSION_PROMPT_EXAMPLES, soundPresetsForFamilies } from "./sessionPresetData";

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

  it("offers an accessible Fill with similar sounds switch that is off by default (#2316)", () => {
    expect(render({ request })).not.toContain("Fill with similar sounds");

    const off = render({ request, fillSimilar: { enabled: false, onChange: vi.fn() } });
    expect(off).toContain("Fill with similar sounds");
    expect(off).toContain("Off: the DJ plays only what matches your request");
    expect(off).toMatch(/<input[^>]*role="switch"/);
    expect(off).not.toMatch(/<input[^>]*checked=""/);
    expect(off).toMatch(/<label[^>]*for="[^"]*-fill-similar"/);
    // It sits in the Adjust row, next to Energy and the explicit choice.
    expect(off.indexOf("Fill with similar sounds")).toBeGreaterThan(off.indexOf('data-testid="agent-session-adjust"'));

    const on = render({ request, fillSimilar: { enabled: true, onChange: vi.fn() } });
    expect(on).toMatch(/<input[^>]*checked=""/);
    expect(on).toContain("marks them as outside your request");
  });

  it("does not offer Fill with similar sounds inside My Mix, which has its own lanes (#2316)", () => {
    const html = render({
      fillSimilar: { enabled: false, onChange: vi.fn() },
      myMix: { lanes: [], vocabulary: { genres: [], moods: [] }, preferences: { lanes: [] } as never, onSelect: vi.fn(), onChange: vi.fn(), onSave: vi.fn() },
    });
    expect(html).not.toContain("Fill with similar sounds");
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

  describe("Right now (#2245)", () => {
    const ready: AgentRightNow = {
      status: "ready",
      context: "evening:weekday",
      highlights: ["Deep House", "Jazz"],
    };
    const cold: AgentRightNow = { status: "cold_start", context: "evening:weekday", reason: "no_history" };
    const rightNow = (summary: AgentRightNow, selected = false) => ({ summary, selected, onSelect: vi.fn() });

    it("is the first For you starter, with its reason always visible", () => {
      const html = render({ rightNow: rightNow(ready) });
      expect(html).toContain(">For you<");
      expect(html.indexOf(">Right now</button>")).toBeLessThan(html.indexOf(">Moments<"));
      const reason = html.slice(html.indexOf('data-testid="agent-right-now-reason"'));
      expect(reason).toContain("Your usual weekday-evening mix: Deep House, Jazz.");
      // The reason describes the button for screen readers, and nothing is hidden behind hover.
      expect(html).toMatch(/aria-describedby="([^"]*right-now-reason)"/);
      expect(html).not.toContain('title="');
    });

    it("sits before My Mix and beside the quick starts, without replacing them", () => {
      const myMix = {
        lanes: [myMixLane],
        vocabulary,
        preferences: null,
        onSelect: vi.fn(),
        onChange: vi.fn(),
        onSave: vi.fn(),
      };
      const html = render({ rightNow: rightNow(ready), myMix });
      expect(html.indexOf(">Right now</button>")).toBeLessThan(html.indexOf(">My Mix</button>"));
      expect(html.indexOf(">My Mix</button>")).toBeLessThan(html.indexOf(">Moments<"));
      expect(html).toContain(">Moments<");
      expect(html).toContain(">Sounds<");
    });

    it("shows the For you row for Right now alone, since My Mix needs lanes", () => {
      const html = render({ rightNow: rightNow(ready) });
      expect(html).toContain(">For you<");
      expect(html).not.toContain(">My Mix</button>");
    });

    it("says so on a cold start and names the saved vibes as the fallback", () => {
      const html = render({ rightNow: rightNow(cold) });
      expect(html).toContain("Not enough listening history yet. Your DJ will start from your saved vibes.");
      const noContext = render({
        rightNow: rightNow({ status: "cold_start", context: "morning:weekend", reason: "no_context_history" }),
      });
      expect(noContext).toContain("Not enough listening history for a weekend-morning yet.");
    });

    it("marks the chosen starter and explains that it sets no filters", () => {
      const html = render({ rightNow: rightNow(ready, true) });
      const button = html.slice(html.lastIndexOf("<button", html.indexOf(">Right now</button>")), html.indexOf(">Right now</button>"));
      expect(button).toContain('aria-pressed="true"');
      expect(button).toContain("active");
      expect(render({ rightNow: rightNow(ready, false) })).toContain('aria-pressed="false"');
      const about = html.slice(html.indexOf('data-testid="agent-right-now-about"'));
      expect(about).toContain("Right now sets no filters.");
      expect(render({ rightNow: rightNow(ready, false) })).not.toContain("agent-right-now-about");
    });

    it("is hidden when its data is missing: no dead starter", () => {
      const html = render();
      expect(html).not.toContain("Right now");
      expect(html).not.toContain("agent-right-now-reason");
    });

    it("tells the empty state that the time of day leads, with the saved vibes as the fallback", () => {
      const withHabits = render({ rightNow: rightNow(ready), savedVibes: ["Chill", "Jazz"] });
      expect(withHabits).toContain("With no filters, your DJ follows your usual weekday-evening mix.");
      expect(withHabits).toContain("<strong>Chill, Jazz</strong>");
      // Cold start: nothing else to follow, so the saved vibes are what the DJ starts from.
      const coldStart = render({ rightNow: rightNow(cold), savedVibes: ["Chill", "Jazz"] });
      expect(coldStart).toContain("With no filters, your DJ starts from:");
    });
  });

  describe("More like... and New artists in... (#2249)", () => {
    const moreLike = (selected = false, title = "Harbor Lights") => ({ title, selected, onSelect: vi.fn() });
    const newArtists = (selected = false) => ({ familyName: "Jazz", selected, onSelect: vi.fn() });
    const rightNow = { summary: { status: "ready" as const, context: "evening:weekday" as const, highlights: ["Jazz"] }, selected: false, onSelect: vi.fn() };
    const myMix = { lanes: [myMixLane], vocabulary, preferences: null, onSelect: vi.fn(), onChange: vi.fn(), onSave: vi.fn() };

    it("lists the For you starters in order: Right now, More like, New artists, My Mix", () => {
      const html = render({ rightNow, moreLike: moreLike(), newArtists: newArtists(), myMix });
      const order = [">Right now</button>", "More like Harbor Lights</button>", "New artists in Jazz</button>", ">My Mix</button>", ">Moments<"];
      const positions = order.map((needle) => html.indexOf(needle));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });

    it("shows the row for either starter alone, and nothing for a missing one", () => {
      expect(render({ moreLike: moreLike() })).toContain(">For you<");
      expect(render({ newArtists: newArtists() })).toContain(">For you<");
      const none = render();
      expect(none).not.toContain("More like");
      expect(none).not.toContain("New artists in");
      expect(none).not.toContain(">For you<");
    });

    it("keeps a long track title short on the button and whole for assistive technology", () => {
      const title = "A Very Long Track Title That Would Break The Button Layout";
      const html = render({ moreLike: moreLike(false, title) });
      expect(html).toContain(`aria-label="More like ${title}"`);
      expect(html).toContain("More like A Very Long Track Title Tha…</button>");
    });

    it("marks the chosen starters", () => {
      const html = render({ moreLike: moreLike(true), newArtists: newArtists(true) });
      expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
      expect(render({ moreLike: moreLike(), newArtists: newArtists() })).not.toContain('aria-pressed="true"');
    });

    it("shows a removable chip while the session is limited to new artists", () => {
      const html = render({ newArtistsOnly: true, request });
      expect(html).toContain("New artists only");
      expect(html).toContain('aria-label="Remove filter New artists only"');
      expect(render({ request })).not.toContain("New artists only");
    });
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

  it("shows the session seed as a removable From chip ahead of the other chips (#2244)", () => {
    const html = render({ request, seed: { label: "Late night" } });
    expect(html).toContain("From: Late night");
    expect(html).toContain('aria-label="Remove filter From: Late night"');
    expect(html).toContain("aid-prompt-chip--seed");
    expect(html.indexOf("From: Late night")).toBeLessThan(html.indexOf("Deep house"));
    expect(render({ request })).not.toContain("From:");
    // A seed alone is a visible choice too, not the "starts from your saved vibes" line.
    expect(render({ seed: { label: "Late night" }, savedVibes: ["Chill"] })).not.toContain("With no filters");
  });

  it("keeps an unknown name under Didn't catch", () => {
    expect(render({ unparsed: ["Zed Nonexistent"] })).toContain("Zed Nonexistent");
  });
});

describe("AgentSessionPrompt Sounds counts (#2249)", () => {
  const families = [
    { id: "world", label: "World", count: 41 },
    { id: "jazz", label: "Jazz", count: 12 },
    { id: "hip-hop", label: "Hip-Hop", count: 7 },
  ];

  it("shows a light count next to each Sounds starter and none without data", () => {
    const { presets, counts } = soundPresetsForFamilies(families);
    const html = render({
      presets: [...SESSION_PRESETS.filter((preset) => preset.group === "mood"), ...presets],
      soundCounts: counts,
    });
    expect(html).toMatch(/World Music<span[^>]*>· 40\+/);
    expect(html).toMatch(/>Jazz<span[^>]*>· 10\+/);
    expect(html).toMatch(/Hip-Hop &amp; Rap<span[^>]*>· 7/);
    // Moments carry no count.
    expect(html).not.toMatch(/Focus<span/);
    expect(render()).not.toContain("aid-prompt-preset-count");
  });

  it("lists Sounds in the order given and omits families that were not returned", () => {
    const { presets, counts } = soundPresetsForFamilies(families);
    const html = render({ presets, soundCounts: counts });
    expect(html.indexOf("World Music")).toBeLessThan(html.indexOf(">Jazz<"));
    expect(html.indexOf(">Jazz<")).toBeLessThan(html.indexOf("Hip-Hop &amp; Rap"));
    expect(html).not.toContain("Reggae &amp; Dancehall");
    expect(html).not.toContain("Pop Hits");
  });
});

describe("AgentSessionPrompt Discovery, Tempo and the tip (#2327)", () => {
  it("offers Discovery as three labelled steps with Mixed pressed by default", () => {
    expect(render()).not.toContain("Discovery");
    const html = render({ discovery: { value: "mixed", onChange: vi.fn() } });
    expect(html).toContain('data-testid="agent-session-discovery"');
    expect(html).toMatch(/role="group"[^>]*aria-labelledby="[^"]*-discovery"/);
    for (const label of ["Familiar", "Mixed", "New"]) expect(html).toMatch(new RegExp(`<button[^>]*>${label}</button>`));
    expect(html.indexOf(">Familiar<")).toBeLessThan(html.indexOf(">Mixed<"));
    expect(html.indexOf(">Mixed<")).toBeLessThan(html.indexOf(">New<"));
    expect(html).toMatch(/aria-pressed="true"[^>]*>Mixed</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Familiar</);
    expect(html).toContain("Mixed (the default)");
    // It sits in the Adjust area.
    expect(html.indexOf('data-testid="agent-session-discovery"')).toBeGreaterThan(html.indexOf('data-testid="agent-session-adjust"'));
  });

  it("says what each step does and that New still follows the request", () => {
    expect(render({ discovery: { value: "familiar", onChange: vi.fn() } })).toContain("No picks are kept for artists you haven");
    expect(render({ discovery: { value: "new", onChange: vi.fn() } })).toContain("They still have to match your request");
  });

  it("keeps Discovery in My Mix, where only Energy, Tempo and Fill with similar sounds are hidden", () => {
    const html = render({
      discovery: { value: "new", onChange: vi.fn() },
      onTempoChange: vi.fn(),
      myMix: { lanes: [], vocabulary: { genres: [], moods: [] }, preferences: { lanes: [] } as never, onSelect: vi.fn(), onChange: vi.fn(), onSave: vi.fn() },
    });
    expect(html).toContain('data-testid="agent-session-discovery"');
    expect(html).not.toContain('data-testid="agent-session-tempo"');
  });

  it("offers Tempo only when it can be applied, showing the current range and the honest coverage note", () => {
    expect(render({ request })).not.toContain('data-testid="agent-session-tempo"');
    const html = render({ request, onTempoChange: vi.fn() });
    expect(html).toContain('data-testid="agent-session-tempo"');
    expect(html).toContain("Tempo (BPM)");
    expect(html).toMatch(/aria-label="Lowest tempo in BPM"[^>]*value="120"/);
    expect(html).toMatch(/aria-label="Highest tempo in BPM"[^>]*value="125"/);
    expect(html).toContain("Only tracks with a measured tempo can match");
    expect(html).toContain("Clear tempo");
    expect(html.indexOf('data-testid="agent-session-tempo"')).toBeGreaterThan(html.indexOf('data-testid="agent-session-adjust"'));
  });

  it("starts Tempo empty with no Clear action when the request has no tempo", () => {
    const html = render({ request: { ...request, bpm: null }, onTempoChange: vi.fn() });
    expect(html).toMatch(/aria-label="Lowest tempo in BPM"[^>]*value=""/);
    expect(html).not.toContain("Clear tempo");
  });

  it("shows the first-session tip with an example to try and a dismiss action, and nothing otherwise", () => {
    expect(render()).not.toContain("agent-first-session-tip");
    const html = render({ tip: { example: "Afrobeats, chill", onTry: vi.fn(), onDismiss: vi.fn() } });
    expect(html).toContain('data-testid="agent-first-session-tip"');
    expect(html).toContain("Tip: you can combine");
    expect(html).toMatch(/<button[^>]*>Afrobeats, chill<\/button>/);
    expect(html).toContain('aria-label="Dismiss this tip"');
  });
});
