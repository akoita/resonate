import { describe, expect, it } from "vitest";
import type { RemixSectionGrid } from "./api";
import {
  describeRemix,
  describeShapeLabel,
  formatSongLength,
  parseRemixDescription,
  planToEdits,
  REMIX_DESCRIBE_AMOUNTS,
  REMIX_DESCRIBE_SHAPE_LABELS,
  sameDescribeEdits,
  type RemixDescribeContext,
  type RemixDescribeEdits,
  type RemixDescribeStem,
  type RemixIntentDirective,
} from "./remixDescribe";
import { REMIX_FX_SCHEMA_VERSION, remixFxMaster, type RemixFxRecipe } from "./remixFx";
import {
  extendedMix,
  shortEdit,
  structureEditState,
  structureTooLongReason,
} from "./remixStructure";

/** Directives without their phrase, for compact expectations. */
function kinds(text: string): Array<Omit<RemixIntentDirective, "phrase">> {
  return parseRemixDescription(text).directives.map((directive) => {
    const { phrase: _phrase, ...rest } = directive;
    void _phrase;
    return rest;
  });
}

function first(text: string): RemixIntentDirective | undefined {
  return parseRemixDescription(text).directives[0];
}

describe("parseRemixDescription (#1900)", () => {
  it("reads the headline example as tempo, space, a mute and a shape", () => {
    const plan = parseRemixDescription("slower and dreamy, no drums, make it longer");
    expect(plan.directives).toEqual([
      { kind: "speed", direction: "slower", intensity: "normal", phrase: "slower" },
      { kind: "space", direction: "more", intensity: "normal", phrase: "dreamy" },
      {
        kind: "tone",
        direction: "darker",
        intensity: "bit",
        implied: true,
        phrase: "dreamy",
      },
      { kind: "stemMute", stemType: "drums", phrase: "no drums" },
      { kind: "shape", id: "extended", phrase: "longer" },
    ]);
    expect(plan.unrecognizedWords).toEqual([]);
    expect(plan.notes).toEqual([]);
  });

  it("returns an empty plan for empty, blank or punctuation-only text", () => {
    for (const text of ["", "   ", "... !!! ,,,", "the and a"]) {
      expect(parseRemixDescription(text)).toEqual({
        directives: [],
        unrecognizedWords: [],
        notes: [],
      });
    }
    // Defensive: a non-string never throws.
    expect(parseRemixDescription(undefined as unknown as string).directives).toEqual([]);
  });

  it.each([
    ["slower", "slower"],
    ["slow", "slower"],
    ["slowed", "slower"],
    ["slow it down", "slower"],
    ["faster", "faster"],
    ["sped up", "faster"],
    ["speed it up", "faster"],
    ["quicker", "faster"],
  ])("tempo: %s", (text, direction) => {
    expect(first(text)).toMatchObject({ kind: "speed", direction, intensity: "normal" });
  });

  it("nightcore is very fast unless told otherwise", () => {
    expect(first("nightcore")).toMatchObject({ direction: "faster", intensity: "very" });
    expect(first("a bit nightcore")).toMatchObject({ intensity: "bit" });
  });

  it.each(["dreamy", "spacey", "ethereal", "airy"])(
    "space: %s adds space and implies a little darker tone",
    (word) => {
      expect(kinds(word)).toEqual([
        { kind: "space", direction: "more", intensity: "normal" },
        { kind: "tone", direction: "darker", intensity: "bit", implied: true },
      ]);
    },
  );

  it.each(["reverb", "roomy", "spacious"])("space: %s adds space only", (word) => {
    expect(kinds(word)).toEqual([{ kind: "space", direction: "more", intensity: "normal" }]);
  });

  it.each(["dry", "tight", "no reverb", "less reverb", "not dreamy"])(
    "space: %s takes it away",
    (text) => {
      expect(kinds(text)).toEqual([{ kind: "space", direction: "less", intensity: "normal" }]);
    },
  );

  it.each([
    ["dark", "darker"],
    ["moody", "darker"],
    ["muffled", "darker"],
    ["bright", "brighter"],
    ["crisp", "brighter"],
    ["not so dark", "less_dark"],
    ["too dark", "less_dark"],
    ["less bright", "less_bright"],
  ])("tone: %s", (text, direction) => {
    expect(first(text)).toMatchObject({ kind: "tone", direction });
    expect(first(text)).not.toHaveProperty("implied");
  });

  it.each([
    ["warm", "more"],
    ["vintage", "more"],
    ["tape", "more"],
    ["clean", "less"],
    ["not so warm", "less"],
  ])("warmth: %s", (text, direction) => {
    expect(first(text)).toMatchObject({ kind: "warmth", direction });
  });

  it.each([
    ["lo-fi", "lofi"],
    ["lofi", "lofi"],
    ["lo fi", "lofi"],
    ["chill", "lofi"],
    ["club", "club"],
    ["dance", "club"],
    ["party", "club"],
    ["slowed + reverb", "slowed_reverb"],
    ["no effects", "none"],
    ["without fx", "none"],
  ])("vibe: %s", (text, id) => {
    expect(kinds(text)).toEqual([{ kind: "vibe", id }]);
  });

  it.each([
    ["a bit slower", "bit"],
    ["slightly slower", "bit"],
    ["a little slower", "bit"],
    ["a touch slower", "bit"],
    ["very slow", "very"],
    ["super slow", "very"],
    ["much slower", "very"],
    ["way slower", "very"],
  ])("intensity: %s", (text, intensity) => {
    expect(first(text)).toMatchObject({ kind: "speed", intensity });
  });

  it("negation: speed back toward the original", () => {
    expect(first("not so slow")).toMatchObject({ direction: "less_slow" });
    expect(first("too fast")).toMatchObject({ direction: "less_fast" });
  });

  it.each([
    ["no drums", "drums"],
    ["without the vocals", "vocals"],
    ["don't want the bass", "bass"],
    ["mute the guitar", "guitar"],
    ["turn off the piano", "piano"],
    ["get rid of the keys", "piano"],
    ["drums off", "drums"],
    ["vocals out", "vocals"],
    ["no beat", "drums"],
    ["no singing", "vocals"],
  ])("mute: %s", (text, stemType) => {
    expect(kinds(text)).toEqual([{ kind: "stemMute", stemType }]);
  });

  it("a negation carries over and-joined parts, not past the clause", () => {
    expect(kinds("no drums and bass")).toEqual([
      { kind: "stemMute", stemType: "drums" },
      { kind: "stemMute", stemType: "bass" },
    ]);
    expect(kinds("no drums, slower")).toEqual([
      { kind: "stemMute", stemType: "drums" },
      { kind: "speed", direction: "slower", intensity: "normal" },
    ]);
    expect(kinds("no drums and slower")[1]).toMatchObject({ direction: "slower" });
    expect(kinds("no drums but bright")[1]).toMatchObject({ direction: "brighter" });
  });

  it.each([
    ["only vocals", ["vocals"]],
    ["vocals only", ["vocals"]],
    ["just the vocals", ["vocals"]],
    ["vocals alone", ["vocals"]],
    ["acapella", ["vocals"]],
    ["a cappella", ["vocals"]],
    ["just the drums and bass", ["drums", "bass"]],
  ])("only: %s", (text, types) => {
    expect(kinds(text)).toEqual(types.map((stemType) => ({ kind: "only", stemType })));
  });

  it.each(["instrumental", "karaoke", "Karaoke version!"])("instrumental: %s", (text) => {
    expect(kinds(text)).toEqual([{ kind: "instrumental" }]);
  });

  it("echo: on a named part, the vocals by default, or taken away", () => {
    const echo = (stemType: string | null, direction = "more", intensity = "normal") => ({
      kind: "stemEcho",
      stemType,
      direction,
      intensity,
    });
    expect(kinds("vocal echo")).toEqual([echo("vocals")]);
    expect(kinds("echo the vocals")).toEqual([echo("vocals")]);
    expect(kinds("echo on vocals and drums")).toEqual([echo("vocals"), echo("drums")]);
    expect(kinds("vocals with echo")).toEqual([echo("vocals")]);
    expect(kinds("add a bit of echo")).toEqual([echo(null, "more", "bit")]);
    expect(kinds("no echo")).toEqual([echo(null, "less")]);
    expect(kinds("no vocal echo")).toEqual([echo("vocals", "less")]);
    expect(kinds("too much echo")).toEqual([echo(null, "less", "very")]);
  });

  it.each([
    ["longer", "extended"],
    ["extended", "extended"],
    ["make it longer", "extended"],
    ["shorter", "short"],
    ["short", "short"],
    ["radio edit", "short"],
    ["original length", "original"],
    ["not so long", "original"],
    ["too short", "original"],
  ])("shape: %s", (text, id) => {
    expect(kinds(text)).toEqual([{ kind: "shape", id }]);
  });

  it("ignores case and punctuation", () => {
    expect(kinds("SLOWER!!! Dreamy...")).toEqual(kinds("slower dreamy"));
    expect(kinds("No-Drums; LONGER?")).toEqual(kinds("no drums, longer"));
  });

  it("keeps the words as written in each phrase", () => {
    const phrases = parseRemixDescription(
      "a bit less reverb, not so dark, without the drums, echo on the vocals",
    ).directives.map((directive) => directive.phrase);
    expect(phrases).toEqual([
      "a bit less reverb",
      "not so dark",
      "without the drums",
      "echo on the vocals",
    ]);
  });

  it("lists meaningful unknown words, never filler", () => {
    const plan = parseRemixDescription("make it slower please, with purple bananas and 3 lasers");
    expect(kinds("slower")).toEqual(
      plan.directives.map(({ phrase: _phrase, ...rest }) => {
        void _phrase;
        return rest;
      }),
    );
    expect(plan.unrecognizedWords).toEqual(["purple", "bananas", "lasers"]);
    // A part with no action is not understood either.
    expect(parseRemixDescription("louder vocals").unrecognizedWords).toEqual([
      "louder",
      "vocals",
    ]);
    // Duplicates are listed once.
    expect(parseRemixDescription("banana banana").unrecognizedWords).toEqual(["banana"]);
  });

  it("explains understood-but-unsupported asks instead of guessing", () => {
    const quieter = parseRemixDescription("less drums");
    expect(quieter.directives).toEqual([]);
    expect(quieter.notes[0]).toContain('"no drums"');
    const unvibe = parseRemixDescription("not lo-fi");
    expect(unvibe.directives).toEqual([]);
    expect(unvibe.notes[0]).toContain('"no effects"');
  });

  it("caps runaway phrasing: many directives parse in order", () => {
    expect(
      kinds("faster, brighter, warm, club, shorter").map((directive) => directive.kind),
    ).toEqual(["speed", "tone", "warmth", "vibe", "shape"]);
  });
});

// ---------------------------------------------------------------------------

const grid: RemixSectionGrid = {
  kind: "bars",
  sections: [0, 16, 32, 48].map((startSec) => ({ startSec, endSec: startSec + 16 })),
  sectionSeconds: 16,
  durationSeconds: 64,
  bpm: 120,
};

const STEMS: RemixDescribeStem[] = [
  { stemId: "vox", type: "vocals", name: "Vocals", reference: false },
  { stemId: "drm", type: "drums", name: "Drums", reference: false },
  { stemId: "bas", type: "bass", name: "Bass", reference: false },
  { stemId: "oth", type: "other", name: "Other", reference: false },
  { stemId: "ref", type: "original", name: "Original", reference: true },
];

function editsFor(
  overrides: Partial<RemixDescribeEdits> = {},
  stems: RemixDescribeStem[] = STEMS,
): RemixDescribeEdits & { title: string } {
  const stemEdits: RemixDescribeEdits["stems"] = {};
  for (const stem of stems) {
    stemEdits[stem.stemId] = { gainDb: null, muted: stem.reference, sections: null };
  }
  return { title: "Keep me", stems: stemEdits, effects: null, structure: null, ...overrides };
}

function context(
  overrides: Partial<RemixDescribeEdits> = {},
  extra: Partial<RemixDescribeContext> = {},
): RemixDescribeContext<RemixDescribeEdits & { title: string }> {
  return {
    edits: editsFor(overrides, extra.stems ?? STEMS),
    stems: STEMS,
    grid,
    ...extra,
  } as RemixDescribeContext<RemixDescribeEdits & { title: string }>;
}

function fx(master: RemixFxRecipe["master"]): RemixFxRecipe {
  return { schemaVersion: REMIX_FX_SCHEMA_VERSION, master };
}

describe("planToEdits (#1900)", () => {
  it("turns the headline example into a readable diff", () => {
    const ctx = context();
    const result = describeRemix("slower and dreamy, no drums, make it longer", ctx);
    expect(result.changes).toEqual([
      { label: "Speed", from: "1.00×", to: "0.85×" },
      { label: "Space", from: "0%", to: "40%" },
      { label: "Tone", from: "Neutral", to: "Darker 15%" },
      { label: "Drums", from: "on", to: "muted" },
      { label: "Song shape", from: "Original length", to: "Extended mix (1:04 → 1:36)" },
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.edits.effects).toEqual(fx({ speed: 0.85, space: 0.4, tone: -0.15 }));
    expect(result.edits.stems.drm.muted).toBe(true);
    expect(result.edits.structure).toEqual(
      extendedMix(grid, structureEditState(grid, null, {}))!.structure,
    );
    // Other fields ride along untouched.
    expect(result.edits.title).toBe("Keep me");
    // Pure: the input is not mutated.
    expect(ctx.edits.stems.drm.muted).toBe(false);
    expect(ctx.edits.effects).toBeNull();
  });

  it("maps the amount table from the defaults", () => {
    const master = (text: string) => remixFxMaster(describeRemix(text, context()).edits.effects);
    expect(REMIX_DESCRIBE_AMOUNTS.speedFactor.slower).toEqual({
      bit: 0.92,
      normal: 0.85,
      very: 0.78,
    });
    expect(master("a bit slower").speed).toBe(0.92);
    expect(master("slower").speed).toBe(0.85);
    expect(master("very slow").speed).toBe(0.78);
    expect(master("a bit faster").speed).toBe(1.07);
    expect(master("faster").speed).toBe(1.15);
    expect(master("very fast").speed).toBe(1.25);
    expect(master("a bit roomy").space).toBe(0.2);
    expect(master("roomy").space).toBe(0.4);
    expect(master("very roomy").space).toBe(0.6);
    expect(master("a bit darker").tone).toBe(-0.15);
    expect(master("darker").tone).toBe(-0.3);
    expect(master("super dark").tone).toBe(-0.45);
    expect(master("brighter").tone).toBe(0.3);
    expect(master("a bit warm").warmth).toBe(0.2);
    expect(master("warm").warmth).toBe(0.4);
    expect(master("very warm").warmth).toBe(0.6);
  });

  it("is relative to the current values and clamps to the ranges", () => {
    const slowed = context({ effects: fx({ speed: 0.85, space: 0.8, tone: -0.9 }) });
    const master = (text: string) => remixFxMaster(describeRemix(text, slowed).edits.effects);
    expect(master("slower").speed).toBe(0.75); // 0.7225 → clamped
    expect(master("very roomy").space).toBe(1);
    expect(master("darker").tone).toBe(-1);
    expect(master("not so slow").speed).toBe(1);
    expect(master("a bit less slow").speed).toBe(0.93); // halfway back
    expect(master("no reverb").space).toBe(0);
    expect(master("a bit less reverb").space).toBe(0.4);
    expect(master("not so dark").tone).toBe(0);
    // Taking away a quality that isn't there changes nothing.
    const plain = context();
    const nothing = describeRemix("not so dark, not so fast, no reverb", plain);
    expect(nothing.changes).toEqual([]);
    expect(nothing.edits).toBe(plain.edits);
  });

  it("applies the vibe first and lets explicit slider words refine it", () => {
    // Text order doesn't matter: the vibe lands first, then "faster".
    const club = describeRemix("faster, club", context());
    expect(remixFxMaster(club.edits.effects).speed).toBe(1.21); // 1.05 × 1.15
    const lofi = describeRemix("lo-fi but brighter", context());
    expect(remixFxMaster(lofi.edits.effects)).toEqual({
      speed: 0.95,
      space: 0.15,
      tone: -0.15, // −0.45 + 0.3
      warmth: 0.5,
    });
    // The last vibe named wins.
    expect(remixFxMaster(describeRemix("club, no wait, lofi", context()).edits.effects).warmth).toBe(
      0.5,
    );
    // "No effects" clears everything, stem fx included.
    const busy = context({
      effects: {
        schemaVersion: REMIX_FX_SCHEMA_VERSION,
        master: { speed: 1.2 },
        stems: { vox: { echo: 0.5 } },
      },
    });
    const cleared = describeRemix("no effects", busy);
    expect(cleared.edits.effects).toBeNull();
    expect(cleared.changes).toEqual([
      { label: "Speed", from: "1.20×", to: "1.00×" },
      { label: "Vocals echo", from: "50%", to: "0%" },
    ]);
  });

  it("an explicit tone word replaces the tone dreamy implies", () => {
    const result = describeRemix("dreamy but bright", context());
    expect(remixFxMaster(result.edits.effects)).toMatchObject({ space: 0.4, tone: 0.3 });
  });

  it("maps part words to stems by type and never touches reference stems", () => {
    const vocalType: RemixDescribeStem[] = [
      { stemId: "v1", type: "Vocal", name: "Lead Vocal", reference: false },
      { stemId: "d1", type: "drums", name: "Drums", reference: false },
      { stemId: "full", type: "original", name: "Original", reference: true },
    ];
    const ctx: RemixDescribeContext = {
      edits: {
        stems: {
          v1: { gainDb: -3, muted: false, sections: null },
          d1: { gainDb: null, muted: false, sections: null },
          // An unmuted reference (the listener is A/B-ing) stays unmuted.
          full: { gainDb: null, muted: false, sections: null },
        },
        effects: null,
        structure: null,
      },
      stems: vocalType,
      grid,
    };
    const muted = planToEdits(parseRemixDescription("no vocals"), ctx);
    expect(muted.edits.stems.v1).toEqual({ gainDb: -3, muted: true, sections: null });
    expect(muted.changes).toEqual([{ label: "Lead Vocal", from: "on", to: "muted" }]);
    for (const text of ["instrumental", "only drums", "acapella", "no effects, echo"]) {
      const result = planToEdits(parseRemixDescription(text), ctx);
      expect(result.edits.stems.full).toEqual(ctx.edits.stems.full);
      expect(result.edits.effects?.stems?.full).toBeUndefined();
    }
  });

  it("reports missing parts in plain words", () => {
    const result = describeRemix("no guitar, only piano, slower", context());
    expect(result.skipped).toEqual([
      "This track has no piano stem",
      "This track has no guitar stem",
    ]);
    // The rest still applies.
    expect(result.changes).toEqual([{ label: "Speed", from: "1.00×", to: "0.85×" }]);
  });

  it("only / acapella / instrumental reuse the one-click arrangements", () => {
    const masked = context({
      stems: {
        ...editsFor().stems,
        vox: { gainDb: 2, muted: true, sections: [true, false, true, true] },
      },
    });
    const acapella = describeRemix("vocals only", masked);
    expect(acapella.edits.stems.vox).toEqual({ gainDb: 2, muted: false, sections: null });
    expect(acapella.edits.stems.drm.muted).toBe(true);
    expect(acapella.edits.stems.bas.muted).toBe(true);
    expect(acapella.edits.stems.oth.muted).toBe(true);
    expect(acapella.changes).toEqual([
      { label: "Vocals", from: "muted", to: "on" },
      { label: "Drums", from: "on", to: "muted" },
      { label: "Bass", from: "on", to: "muted" },
      { label: "Other", from: "on", to: "muted" },
    ]);

    const rhythm = describeRemix("just the drums and bass", context());
    expect(
      Object.fromEntries(Object.entries(rhythm.edits.stems).map(([id, edit]) => [id, edit.muted])),
    ).toEqual({ vox: true, drm: false, bas: false, oth: true, ref: true });

    const karaoke = describeRemix("karaoke", context());
    expect(karaoke.changes).toEqual([{ label: "Vocals", from: "on", to: "muted" }]);

    // Other part sets keep exactly the named parts.
    const otherOnly = describeRemix("only other", context());
    expect(otherOnly.changes.map((change) => change.label)).toEqual(["Vocals", "Drums", "Bass"]);

    // The last arrangement word wins.
    expect(describeRemix("only vocals, no, instrumental", context()).edits.stems.vox.muted).toBe(
      true,
    );
  });

  it("instrumental without a vocal stem says so", () => {
    const noVocals = STEMS.filter((stem) => stem.type !== "vocals");
    const ctx = context({}, { stems: noVocals });
    const result = describeRemix("instrumental", ctx);
    expect(result.changes).toEqual([]);
    expect(result.skipped).toEqual(["This track has no vocal stem"]);
  });

  it("echo goes to the vocals by default and 'no echo' clears every part", () => {
    const added = describeRemix("add some echo", context());
    expect(added.edits.effects?.stems).toEqual({ vox: { echo: 0.4 } });
    expect(added.changes).toEqual([{ label: "Vocals echo", from: "0%", to: "40%" }]);

    const echoed = context({
      effects: {
        schemaVersion: REMIX_FX_SCHEMA_VERSION,
        stems: { vox: { echo: 0.6 }, drm: { echo: 0.2, tone: 0.3 } },
      },
    });
    const cleared = describeRemix("no echo", echoed);
    expect(cleared.edits.effects?.stems).toEqual({ drm: { tone: 0.3 } });
    expect(describeRemix("a bit less vocal echo", echoed).edits.effects?.stems?.vox).toEqual({
      echo: 0.3,
    });
    expect(describeRemix("echo on the guitar", context()).skipped).toEqual([
      "This track has no guitar stem",
    ]);
  });

  it("reshapes through the shared structure operations", () => {
    const short = describeRemix("radio edit", context());
    expect(short.edits.structure).toEqual(
      shortEdit(grid, structureEditState(grid, null, {}))!.structure,
    );
    expect(short.changes).toEqual([
      { label: "Song shape", from: "Original length", to: "Short edit (1:04 → 0:48)" },
    ]);
    // Back to the original.
    const back = describeRemix("original length", context({ structure: short.edits.structure }));
    expect(back.edits.structure).toBeNull();
    expect(back.changes[0]).toEqual({
      label: "Song shape",
      from: "Short edit",
      to: "Original length (0:48 → 1:04)",
    });
    // Asking for the shape it already has changes nothing.
    expect(describeRemix("shorter", context({ structure: short.edits.structure })).changes).toEqual(
      [],
    );
  });

  it("moves stem masks with the reshaped blocks", () => {
    const masked = context({
      stems: { ...editsFor().stems, drm: { gainDb: null, muted: false, sections: [false, true, true, true] } },
    });
    const result = describeRemix("longer", masked);
    // Extended: blocks 0,0,1,2,3,3 — section 0 is off in both of its blocks.
    expect(result.edits.stems.drm.sections).toEqual([false, false, true, true, true, true]);
  });

  it("reports the length cap when an extended mix is refused", () => {
    const tight = { ...grid, durationSeconds: 40 }; // cap 80 s < 96 s
    const result = describeRemix("longer and slower", context({}, { grid: tight }));
    expect(result.skipped).toEqual([structureTooLongReason(tight)]);
    expect(result.edits.structure).toBeNull();
    expect(result.changes.map((change) => change.label)).toEqual(["Speed"]);
  });

  it("says so when there is no section grid to reshape", () => {
    const result = describeRemix("longer", context({}, { grid: null }));
    expect(result.skipped).toEqual(["This song has no sections to reshape yet"]);
    expect(result.changes).toEqual([]);
  });

  it("is deterministic", () => {
    const text = "a bit slower, dreamy, no drums, vocal echo, radio edit";
    expect(describeRemix(text, context())).toEqual(describeRemix(text, context()));
  });

  it("returns the input edits when nothing was understood", () => {
    const ctx = context();
    const result = describeRemix("purple bananas", ctx);
    expect(result.edits).toBe(ctx.edits);
    expect(result.changes).toEqual([]);
    expect(result.plan.unrecognizedWords).toEqual(["purple", "bananas"]);
  });
});

describe("describeShapeLabel / sameDescribeEdits (#1900)", () => {
  it("formats song lengths as m:ss", () => {
    expect(formatSongLength(216)).toBe("3:36");
    expect(formatSongLength(288.4)).toBe("4:48");
    expect(formatSongLength(59.6)).toBe("1:00");
    expect(formatSongLength(-1)).toBe("0:00");
    expect(formatSongLength(Number.NaN)).toBe("0:00");
  });


  it("names the three shapes and anything else as custom", () => {
    const state = structureEditState(grid, null, {});
    expect(describeShapeLabel(grid, null)).toBe(REMIX_DESCRIBE_SHAPE_LABELS.original);
    expect(describeShapeLabel(grid, extendedMix(grid, state)!.structure)).toBe("Extended mix");
    expect(describeShapeLabel(grid, shortEdit(grid, state)!.structure)).toBe("Short edit");
    expect(
      describeShapeLabel(grid, {
        schemaVersion: "remix-structure/v1",
        blocks: [{ section: 3 }, { section: 0 }],
      }),
    ).toBe("Custom shape");
  });

  it("compares only what a description changes", () => {
    const base = editsFor();
    expect(sameDescribeEdits(base, { ...base, stems: { ...base.stems } })).toBe(true);
    const gain = { ...base, stems: { ...base.stems, vox: { ...base.stems.vox, gainDb: 4 } } };
    expect(sameDescribeEdits(base, gain)).toBe(true);
    const muted = { ...base, stems: { ...base.stems, vox: { ...base.stems.vox, muted: true } } };
    expect(sameDescribeEdits(base, muted)).toBe(false);
    expect(sameDescribeEdits(base, { ...base, effects: fx({ speed: 0.9 }) })).toBe(false);
  });
});
