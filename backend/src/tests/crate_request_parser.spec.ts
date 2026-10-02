/**
 * Crate Digger deterministic request parser (#1962) — pure unit tests.
 *
 * The filters are the contract: these tests pin the exact filters for the RFC
 * example and show that a text request and a reference-track request resolve to
 * the same structure.
 */
import {
  CRATE_REQUEST_PARSER,
  deterministicCrateRequestParser,
  filtersFromReferenceTrack,
  parseCrateRequestText,
} from "../modules/crates/crate_request_parser";
import { defaultCrateFilters, sanitizeCrateFilters } from "../modules/crates/crate_filters";
import {
  CRATE_DEFAULT_COUNT,
  CRATE_MAX_COUNT,
  CRATE_REQUEST_MAX_TEXT_LENGTH,
  type CrateFilters,
} from "../modules/crates/crate.types";

const parse = (text: string) => parseCrateRequestText(text);
const filtersOf = (text: string): CrateFilters => parse(text).filters;
const withDefaults = (overrides: Partial<CrateFilters>): CrateFilters => ({
  ...defaultCrateFilters(),
  ...overrides,
});

describe("parseCrateRequestText", () => {
  describe("the RFC example", () => {
    const text = "peak-time Afro house, 122–124 BPM, acapella available, under $20 total";

    it("produces exactly these filters", () => {
      expect(parse(text)).toEqual({
        filters: withDefaults({
          bpm: { min: 122, max: 124 },
          energy: { min: 0.65, max: 1 },
          requiredStems: ["vocals"],
          maxTotalUsd: 20,
          genres: ["House"],
        }),
        // "Afro house" is not in the catalog vocabulary: House is kept and the
        // word it could not map is reported, not guessed.
        unparsed: ["Afro"],
        strategy: "deterministic",
      });
    });

    it("is deterministic", () => {
      expect(parse(text)).toEqual(parse(text));
    });
  });

  describe("bpm", () => {
    it.each([
      ["122–124 BPM", { min: 122, max: 124 }],
      ["122-124bpm", { min: 122, max: 124 }],
      ["122 to 124 bpm", { min: 122, max: 124 }],
      ["between 122 and 124 bpm", { min: 122, max: 124 }],
      ["124-122 bpm", { min: 122, max: 124 }],
      ["122 bpm to 124 bpm", { min: 122, max: 124 }],
      ["bpm 122-124", { min: 122, max: 124 }],
      ["124 bpm", { min: 122, max: 126 }],
      ["124bpm", { min: 122, max: 126 }],
      ["around 124 bpm", { min: 121, max: 127 }],
      ["about 124.5 bpm", { min: 121.5, max: 127.5 }],
      ["~124 bpm", { min: 121, max: 127 }],
      ["under 130 bpm", { min: null, max: 130 }],
      ["at least 120 bpm", { min: 120, max: null }],
    ])("reads %j", (text, bpm) => {
      expect(filtersOf(text).bpm).toEqual(bpm);
      expect(parse(text).unparsed).toEqual([]);
    });

    it("ignores tempos outside 30..300 and reports them", () => {
      const result = parse("900 bpm");
      expect(result.filters.bpm).toBeNull();
      expect(result.unparsed).toEqual(["900 bpm"]);
    });

    it("keeps a range inside bounds near the edges", () => {
      expect(filtersOf("31 bpm").bpm).toEqual({ min: 30, max: 33 });
      expect(filtersOf("299 bpm").bpm).toEqual({ min: 297, max: 300 });
    });
  });

  describe("keys", () => {
    it.each([
      ["in A minor", ["8A"]],
      ["8A or 9A", ["8A", "9A"]],
      ["keys 8A, 9A", ["8A", "9A"]],
      ["key of D", ["10B"]],
      ["F# minor", ["11A"]],
      ["Bb major", ["6B"]],
      ["Ebm", ["2A"]],
      ["Am", ["8A"]],
      ["Bb", ["6B"]],
      ["C major", ["8B"]],
      ["D♭ major", ["3B"]],
      ["in a minor", ["8A"]],
      ["12b", ["12B"]],
    ])("reads %j", (text, keys) => {
      const result = parse(text);
      expect(result.filters.keys).toEqual(keys);
      expect(result.unparsed).toEqual([]);
    });

    it("keeps neighbours on by default and turns them off on request", () => {
      expect(filtersOf("8A").includeCamelotNeighbors).toBe(true);
      expect(filtersOf("with neighbors 8A").includeCamelotNeighbors).toBe(true);
      for (const text of ["8A, no neighbors", "8A exact key", "8A without neighbours", "exact match 8A"]) {
        const result = parse(text);
        expect(result.filters.includeCamelotNeighbors).toBe(false);
        expect(result.filters.keys).toEqual(["8A"]);
        expect(result.unparsed).toEqual([]);
      }
    });

    it("does not read English as a key", () => {
      for (const text of ["a minor detail", "a major label sound", "Am I ready", "I am a DJ"]) {
        expect(filtersOf(text).keys).toEqual([]);
      }
    });

    it("does not read bpm or counts as Camelot codes", () => {
      const filters = filtersOf("124 bpm, 8 tracks");
      expect(filters.keys).toEqual([]);
      expect(filters.count).toBe(8);
    });

    it("de-duplicates and keeps at most six, reporting the rest", () => {
      const result = parse("1A 2A 3A 4A 5A 6A 7A 8A 1A");
      expect(result.filters.keys).toEqual(["1A", "2A", "3A", "4A", "5A", "6A"]);
      expect(result.unparsed).toEqual(["7A", "8A"]);
    });
  });

  describe("energy", () => {
    it.each([
      ["peak-time", { min: 0.65, max: 1 }],
      ["peak time", { min: 0.65, max: 1 }],
      ["high energy", { min: 0.65, max: 1 }],
      ["banging", { min: 0.65, max: 1 }],
      ["warm-up", { min: 0, max: 0.45 }],
      ["warm up", { min: 0, max: 0.45 }],
      ["low energy", { min: 0, max: 0.45 }],
      ["chill", { min: 0, max: 0.45 }],
      ["deep", { min: 0, max: 0.45 }],
      ["medium energy", { min: 0.35, max: 0.7 }],
      ["mid", { min: 0.35, max: 0.7 }],
    ])("reads %j", (text, energy) => {
      expect(filtersOf(text).energy).toEqual(energy);
      expect(parse(text).unparsed).toEqual([]);
    });

    it("covers both when the DJ names a build", () => {
      expect(filtersOf("warm-up into peak-time").energy).toEqual({ min: 0, max: 1 });
    });

    it("reads 'deep house' as a genre, not low energy", () => {
      const filters = filtersOf("deep house");
      expect(filters.genres).toEqual(["Deep House"]);
      expect(filters.energy).toBeNull();
    });

    it("does not read warm-up as the Warm mood", () => {
      expect(filtersOf("warm-up").moods).toEqual([]);
      expect(filtersOf("warm vibes").moods).toEqual(["Warm"]);
    });
  });

  describe("stems", () => {
    it.each([
      ["acapella", ["vocals"]],
      ["a cappella", ["vocals"]],
      ["acapella available", ["vocals"]],
      ["vocals available", ["vocals"]],
      ["with vocals", ["vocals"]],
      ["with stems vocals and drums", ["vocals", "drums"]],
      ["with stems: drums, bass, piano", ["drums", "bass", "piano"]],
      ["guitar available", ["guitar"]],
      ["drums and bass stems", ["drums", "bass"]],
      ["piano stem", ["piano"]],
      ["with vocal, guitar", ["vocals", "guitar"]],
    ])("reads %j", (text, stems) => {
      const result = parse(text);
      expect(result.filters.requiredStems).toEqual(stems);
      expect(result.unparsed).toEqual([]);
    });

    it("does not read bass music or drum and bass as stems", () => {
      expect(filtersOf("drum and bass").requiredStems).toEqual([]);
      expect(filtersOf("drum and bass").genres).toEqual(["Drum & Bass"]);
      expect(filtersOf("with bass house vibes").requiredStems).toEqual([]);
      expect(filtersOf("heavy vocals in the mix").requiredStems).toEqual([]);
    });

    it("reads a genre next to a stem request", () => {
      const filters = filtersOf("drum and bass with vocals");
      expect(filters.genres).toEqual(["Drum & Bass"]);
      expect(filters.requiredStems).toEqual(["vocals"]);
    });
  });

  describe("license", () => {
    it.each([
      ["personal", "personal"],
      ["remix license", "remix"],
      ["remix licence", "remix"],
      ["remixable", "remix"],
      ["commercial", "commercial"],
      ["sync license", "sync"],
      ["sample", "sample"],
      ["broadcast", "broadcast"],
      ["licensed for remix", "remix"],
      ["personal use", "personal"],
    ])("reads %j", (text, license) => {
      const result = parse(text);
      expect(result.filters.licenseType).toBe(license);
      expect(result.unparsed).toEqual([]);
    });

    it("keeps the first and reports a conflicting second", () => {
      const result = parse("remix and sync");
      expect(result.filters.licenseType).toBe("remix");
      expect(result.unparsed).toEqual(["sync"]);
    });
  });

  describe("money", () => {
    it.each([
      ["under $20 total", { maxTotalUsd: 20, maxPerItemUsd: null }],
      ["max $20 total", { maxTotalUsd: 20, maxPerItemUsd: null }],
      ["$20 budget", { maxTotalUsd: 20, maxPerItemUsd: null }],
      ["budget of 20 dollars", { maxTotalUsd: 20, maxPerItemUsd: null }],
      ["budget $20", { maxTotalUsd: 20, maxPerItemUsd: null }],
      ["under $20", { maxTotalUsd: 20, maxPerItemUsd: null }],
      ["under 20", { maxTotalUsd: 20, maxPerItemUsd: null }],
      ["20 bucks max", { maxTotalUsd: 20, maxPerItemUsd: null }],
      ["under $12.50 in total", { maxTotalUsd: 12.5, maxPerItemUsd: null }],
      ["under $5 each", { maxTotalUsd: null, maxPerItemUsd: 5 }],
      ["$5 per track", { maxTotalUsd: null, maxPerItemUsd: 5 }],
      ["max $5 per item", { maxTotalUsd: null, maxPerItemUsd: 5 }],
      ["max per item $5", { maxTotalUsd: null, maxPerItemUsd: 5 }],
      ["$5 a track", { maxTotalUsd: null, maxPerItemUsd: 5 }],
      [
        "under $5 each, $40 total",
        { maxTotalUsd: 40, maxPerItemUsd: 5 },
      ],
    ])("reads %j", (text, money) => {
      const result = parse(text);
      expect({
        maxTotalUsd: result.filters.maxTotalUsd,
        maxPerItemUsd: result.filters.maxPerItemUsd,
      }).toEqual(money);
      expect(result.unparsed).toEqual([]);
    });

    it("does not take a bare amount for a price, and reports it", () => {
      const result = parse("$20");
      expect(result.filters.maxTotalUsd).toBeNull();
      expect(result.unparsed).toEqual(["$20"]);
    });

    it("does not read a count or tempo as money", () => {
      const filters = filtersOf("under 20 tracks, around 120 bpm");
      expect(filters.maxTotalUsd).toBeNull();
      expect(filters.count).toBe(20);
    });

    it("ignores absurd amounts", () => {
      expect(filtersOf("under $999999 total").maxTotalUsd).toBeNull();
    });
  });

  describe("human and AI", () => {
    it.each(["verified human", "human only", "humans only", "no AI", "no AI generated", "AI-free", "only humans"])(
      "reads %j as verified human only, never allowing fully AI",
      (text) => {
        const result = parse(text);
        expect(result.filters.verifiedHumanOnly).toBe(true);
        expect(result.filters.allowFullyAi).toBe(false);
        expect(result.unparsed).toEqual([]);
      },
    );

    it.each(["AI ok", "AI allowed", "include AI", "ai-generated is fine", "AI okay"])(
      "reads %j as allowing fully AI",
      (text) => {
        const result = parse(text);
        expect(result.filters.allowFullyAi).toBe(true);
        expect(result.filters.verifiedHumanOnly).toBe(false);
        expect(result.unparsed).toEqual([]);
      },
    );

    it("keeps fully AI recordings out by default", () => {
      expect(filtersOf("peak-time house").allowFullyAi).toBe(false);
      expect(filtersOf("peak-time house").verifiedHumanOnly).toBe(false);
    });
  });

  describe("count", () => {
    it.each([
      ["8 tracks", 8],
      ["10 songs", 10],
      ["a 12-track crate", 12],
      ["crate of 6", 6],
      ["top 10", 10],
      ["top 10 tracks", 10],
      ["a dozen tracks", 12],
      ["five tunes", 5],
      ["100 tracks", CRATE_MAX_COUNT],
      ["0 tracks", 1],
    ])("reads %j as %j", (text, count) => {
      const result = parse(text);
      expect(result.filters.count).toBe(count);
      expect(result.unparsed).toEqual([]);
    });

    it("defaults when none is given", () => {
      expect(filtersOf("house").count).toBe(CRATE_DEFAULT_COUNT);
    });
  });

  describe("genres and moods", () => {
    it("uses the taste-edit vocabulary and aliases", () => {
      const filters = filtersOf("tech house and dnb, hip hop, dark and club, late night");
      // In the order the DJ wrote them.
      expect(filters.genres).toEqual(["Tech House", "Drum & Bass", "Hip-Hop"]);
      expect(filters.moods).toEqual(["Dark", "Club", "Late Night"]);
    });

    it("reads the longest genre first", () => {
      expect(filtersOf("deep house").genres).toEqual(["Deep House"]);
      expect(filtersOf("house").genres).toEqual(["House"]);
    });

    it("reports a genre outside the vocabulary instead of guessing", () => {
      const result = parse("bouyon, 128 bpm");
      expect(result.filters.genres).toEqual([]);
      expect(result.unparsed).toEqual(["bouyon"]);
    });

    it("keeps at most five genres and reports the rest", () => {
      const result = parse("jazz, blues, rock, pop, funk, soul, folk");
      expect(result.filters.genres).toEqual(["Jazz", "Blues", "Rock", "Pop", "Funk"]);
      expect(result.unparsed).toEqual(["soul", "folk"]);
    });
  });

  describe("unparsed honesty", () => {
    it("reports what no rule read, keeping the DJ's own words", () => {
      const result = parse("sunset rooftop vibes, 124 bpm, Afro Tech");
      expect(result.filters.bpm).toEqual({ min: 122, max: 126 });
      expect(result.unparsed).toEqual(["sunset rooftop vibes", "Afro Tech"]);
    });

    it("drops stopwords at the edges of a phrase", () => {
      const result = parse("give me some tracks for a set with spooky organ sounds");
      expect(result.unparsed).toEqual(["spooky organ sounds"]);
    });

    it("reports nothing when everything was read", () => {
      expect(parse("tech house 8A 126 bpm").unparsed).toEqual([]);
      expect(parse("a crate for a set with some tracks").unparsed).toEqual([]);
    });

    it("splits words a read phrase separated", () => {
      expect(parse("moody 124 bpm cinematic").unparsed).toEqual(["moody", "cinematic"]);
    });

    it("is bounded to 10 phrases of 120 characters", () => {
      const many = Array.from({ length: 30 }, (_, i) => `weird${i}x`).join(", ");
      expect(parse(many).unparsed).toHaveLength(10);
      const longPhrase = `${"zzz ".repeat(100)}`.trim();
      const result = parse(longPhrase);
      expect(result.unparsed).toHaveLength(1);
      expect(result.unparsed[0].length).toBeLessThanOrEqual(120);
    });

    it("de-duplicates", () => {
      expect(parse("weirdo, Weirdo, weirdo").unparsed).toEqual(["weirdo"]);
    });
  });

  describe("input handling", () => {
    it("returns the defaults for empty, blank and non-string input", () => {
      for (const text of ["", "   ", "\n\t", undefined as unknown as string, null as unknown as string, 7 as unknown as string]) {
        expect(parse(text)).toEqual({
          filters: defaultCrateFilters(),
          unparsed: [],
          strategy: "deterministic",
        });
      }
    });

    it("truncates text longer than the limit instead of throwing", () => {
      const beyond = `${"x".repeat(CRATE_REQUEST_MAX_TEXT_LENGTH)} 124 bpm under $20 total`;
      const result = parse(beyond);
      // Everything past the limit is ignored, so nothing after it is read.
      expect(result.filters.bpm).toBeNull();
      expect(result.filters.maxTotalUsd).toBeNull();
      expect(result.unparsed.join("").length).toBeLessThanOrEqual(CRATE_REQUEST_MAX_TEXT_LENGTH);

      const within = `${"x ".repeat(100)}124 bpm`;
      expect(within.length).toBeLessThanOrEqual(CRATE_REQUEST_MAX_TEXT_LENGTH);
      expect(parse(within).filters.bpm).toEqual({ min: 122, max: 126 });
    });

    it("is fast on adversarial input", () => {
      const started = Date.now();
      for (const text of [
        "with vocals, ".repeat(60),
        "8A ".repeat(200),
        "under $5 ".repeat(100),
        "a".repeat(600),
        "- ".repeat(300),
        "🎧".repeat(300),
      ]) {
        parse(text);
      }
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it("handles emoji and mixed unicode in the middle of a request", () => {
      const result = parse("🎧 peak time 😀 minimal 128bpm Gm");
      expect(result.filters.genres).toEqual(["Minimal"]);
      expect(result.filters.keys).toEqual(["6A"]);
      expect(result.filters.bpm).toEqual({ min: 126, max: 130 });
      expect(result.filters.energy).toEqual({ min: 0.65, max: 1 });
    });

    it("always produces filters that survive sanitization unchanged", () => {
      for (const text of [
        "peak-time Afro house, 122–124 BPM, acapella available, under $20 total",
        "124 bpm, F# minor or Bb major, under $5 each, AI ok, with stems vocals and drums",
        "900 bpm under $99999 25 tracks",
        "",
      ]) {
        const { filters } = parse(text);
        expect(sanitizeCrateFilters(filters)).toEqual({ filters, errors: [] });
      }
    });
  });

  it("combines every kind of filter in one request", () => {
    const result = parse(
      "a 12-track crate of banging tech house, around 128 bpm, keys 8A, 9A, no neighbors, "
        + "acapella available, remix license, under $5 per track, $40 budget, no AI, dark",
    );
    expect(result).toEqual({
      filters: {
        count: 12,
        bpm: { min: 125, max: 131 },
        keys: ["8A", "9A"],
        includeCamelotNeighbors: false,
        energy: { min: 0.65, max: 1 },
        requiredStems: ["vocals"],
        licenseType: "remix",
        maxTotalUsd: 40,
        maxPerItemUsd: 5,
        verifiedHumanOnly: true,
        allowFullyAi: false,
        genres: ["Tech House"],
        moods: ["Dark"],
      },
      unparsed: [],
      strategy: "deterministic",
    });
  });
});

describe("deterministicCrateRequestParser", () => {
  it("implements the parser seam asynchronously with the same result", async () => {
    const text = "peak-time house, 124 bpm";
    await expect(deterministicCrateRequestParser.parse(text)).resolves.toEqual(parseCrateRequestText(text));
  });

  it("has a stable injection token", () => {
    expect(typeof CRATE_REQUEST_PARSER).toBe("symbol");
    expect(CRATE_REQUEST_PARSER.description).toBe("CRATE_REQUEST_PARSER");
  });
});

describe("filtersFromReferenceTrack", () => {
  it("builds tempo, key, energy and genre filters from a full reference", () => {
    expect(
      filtersFromReferenceTrack({ tempoBpm: 124, camelot: "8A", energy: 0.7, genre: "House" }),
    ).toEqual(
      withDefaults({
        bpm: { min: 119, max: 129 },
        keys: ["8A"],
        energy: { min: 0.55, max: 0.85 },
        genres: ["House"],
      }),
    );
  });

  it("rounds the tempo range to one decimal", () => {
    expect(filtersFromReferenceTrack({ tempoBpm: 123.4, camelot: null, energy: null, genre: null }).bpm).toEqual({
      min: 118.5,
      max: 128.3,
    });
  });

  it("clamps energy to 0..1", () => {
    expect(filtersFromReferenceTrack({ tempoBpm: null, camelot: null, energy: 0.95, genre: null }).energy).toEqual({
      min: 0.8,
      max: 1,
    });
    expect(filtersFromReferenceTrack({ tempoBpm: null, camelot: null, energy: 0.05, genre: null }).energy).toEqual({
      min: 0,
      max: 0.2,
    });
  });

  it("leaves everything the track lacks open", () => {
    expect(
      filtersFromReferenceTrack({ tempoBpm: null, camelot: null, energy: null, genre: null }),
    ).toEqual(defaultCrateFilters());
  });

  it("keeps the genre only when it is in the vocabulary", () => {
    expect(filtersFromReferenceTrack({ tempoBpm: null, camelot: null, energy: null, genre: "Afro House" }).genres).toEqual([]);
    expect(filtersFromReferenceTrack({ tempoBpm: null, camelot: null, energy: null, genre: "dnb" }).genres).toEqual(["Drum & Bass"]);
  });

  it("normalizes the reference key and ignores one that is not a key", () => {
    expect(filtersFromReferenceTrack({ tempoBpm: null, camelot: "08a", energy: null, genre: null }).keys).toEqual(["8A"]);
    expect(filtersFromReferenceTrack({ tempoBpm: null, camelot: "nope", energy: null, genre: null }).keys).toEqual([]);
  });

  it("ignores impossible tempos and energies", () => {
    const filters = filtersFromReferenceTrack({ tempoBpm: NaN, camelot: null, energy: Infinity, genre: null });
    expect(filters.bpm).toBeNull();
    expect(filters.energy).toBeNull();
    expect(filtersFromReferenceTrack({ tempoBpm: -4, camelot: null, energy: null, genre: null }).bpm).toBeNull();
  });

  it("takes and clamps a count", () => {
    const ref = { tempoBpm: null, camelot: null, energy: null, genre: null };
    expect(filtersFromReferenceTrack(ref).count).toBe(CRATE_DEFAULT_COUNT);
    expect(filtersFromReferenceTrack(ref, 12).count).toBe(12);
    expect(filtersFromReferenceTrack(ref, 999).count).toBe(CRATE_MAX_COUNT);
    expect(filtersFromReferenceTrack(ref, 0).count).toBe(1);
  });

  it("neither mutates nor shares state between calls", () => {
    const ref = { tempoBpm: 124, camelot: "8A", energy: 0.5, genre: "House" };
    const first = filtersFromReferenceTrack(ref);
    first.keys.push("1A");
    expect(filtersFromReferenceTrack(ref).keys).toEqual(["8A"]);
    expect(ref).toEqual({ tempoBpm: 124, camelot: "8A", energy: 0.5, genre: "House" });
  });
});

describe("text and reference-track requests share one filter structure", () => {
  const shape = (filters: CrateFilters) => ({
    keys: Object.keys(filters).sort(),
    bpm: filters.bpm === null ? null : Object.keys(filters.bpm).sort(),
    energy: filters.energy === null ? null : Object.keys(filters.energy).sort(),
    types: Object.fromEntries(
      Object.entries(filters).map(([key, value]) => [key, Array.isArray(value) ? "array" : typeof value]),
    ),
  });

  it("has identical key sets and field types, with or without values", () => {
    const text = filtersOf("peak-time Afro house, 122–124 BPM, acapella available, under $20 total");
    const ref = filtersFromReferenceTrack({ tempoBpm: 123, camelot: "8A", energy: 0.8, genre: "House" });
    expect(Object.keys(text).sort()).toEqual(Object.keys(ref).sort());
    expect(Object.keys(text).sort()).toEqual(Object.keys(defaultCrateFilters()).sort());
    expect(shape(text).bpm).toEqual(shape(ref).bpm);
    expect(shape(text).energy).toEqual(shape(ref).energy);
    // With nothing to read, both are the same open default.
    expect(filtersFromReferenceTrack({ tempoBpm: null, camelot: null, energy: null, genre: null })).toEqual(
      filtersOf(""),
    );
    expect(shape(filtersOf("")).types).toEqual(shape(filtersFromReferenceTrack({ tempoBpm: null, camelot: null, energy: null, genre: null })).types);
  });

  it("resolves the same request to the same filters either way", () => {
    // A DJ who describes the reference by hand lands on the reference's filters.
    const fromText = filtersOf("house, 118.0-128.0 bpm, 8A, energy ignored");
    const fromRef = filtersFromReferenceTrack({ tempoBpm: 123, camelot: "8A", energy: null, genre: "House" });
    expect(fromText.keys).toEqual(fromRef.keys);
    expect(fromText.genres).toEqual(fromRef.genres);
    expect(fromText.includeCamelotNeighbors).toBe(fromRef.includeCamelotNeighbors);
    expect(fromText.allowFullyAi).toBe(fromRef.allowFullyAi);
    expect(fromRef.bpm).toEqual({ min: 118.1, max: 127.9 });
  });

  it("passes both through sanitization unchanged", () => {
    const text = filtersOf("peak-time house 124 bpm 8A");
    const ref = filtersFromReferenceTrack({ tempoBpm: 124, camelot: "8A", energy: 0.8, genre: "House" });
    expect(sanitizeCrateFilters(text)).toEqual({ filters: text, errors: [] });
    expect(sanitizeCrateFilters(ref)).toEqual({ filters: ref, errors: [] });
  });
});
