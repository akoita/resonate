/**
 * Artist names in an AI DJ session sentence (#2241). Pure unit tests: the
 * "catalog" is a name list, nothing touches a database or the network.
 */
import {
  buildArtistNameIndex,
  findArtistMentions,
  matchArtistName,
  normalizeArtistName,
  sanitizeArtistNames,
  withoutArtistMentions,
} from "../modules/agents/agent_session_artists";
import { unitCentroid } from "../modules/embeddings/vector_centroid";

const CATALOG = buildArtistNameIndex([
  "Nadia Okoro",
  "Kofi Amarteifio",
  "Hana Mori",
  "Beyoncé Marchand",
  "Thando Mbeki-Rowe",
  "Kern",
  "Warm",
  "Orla Voss",
  "Orla Vossen",
  "Sekou Camara",
  "Sekou Camaro",
]);

const namesIn = (text: string) => findArtistMentions(text, CATALOG).map((mention) => mention.name);

describe("normalizeArtistName", () => {
  it("ignores case, diacritics, apostrophes and punctuation", () => {
    expect(normalizeArtistName("  Beyoncé   MARCHAND ")).toBe("beyonce marchand");
    expect(normalizeArtistName("Thando Mbeki-Rowe")).toBe("thando mbeki rowe");
    expect(normalizeArtistName("O’Neil")).toBe("oneil");
  });
});

describe("matchArtistName", () => {
  it("matches exactly, case- and diacritic-insensitively, and returns the catalog spelling", () => {
    expect(matchArtistName("nadia okoro", CATALOG)).toBe("Nadia Okoro");
    expect(matchArtistName("BEYONCE MARCHAND", CATALOG)).toBe("Beyoncé Marchand");
    expect(matchArtistName("thando mbeki rowe", CATALOG)).toBe("Thando Mbeki-Rowe");
  });

  it("accepts one conservative near miss on a long enough name", () => {
    expect(matchArtistName("Nadia Okro", CATALOG)).toBe("Nadia Okoro");
    expect(matchArtistName("Kofi Amarteifo", CATALOG)).toBe("Kofi Amarteifio");
  });

  it("refuses a near miss on a short name, on another first letter, or that two names share", () => {
    expect(matchArtistName("Kerm", CATALOG)).toBeUndefined();
    expect(matchArtistName("Madia Okoro", CATALOG)).toBeUndefined();
    // "Sekou Camara" and "Sekou Camaro" are both one edit from "Sekou Camaru".
    expect(matchArtistName("Sekou Camaru", CATALOG)).toBeUndefined();
  });

  it("never reads a genre or mood word as an artist, even when an artist has that name", () => {
    expect(matchArtistName("warm", CATALOG)).toBeUndefined();
  });

  it("does not match a name the catalog does not have", () => {
    expect(matchArtistName("Zed Nonexistent", CATALOG)).toBeUndefined();
  });
});

describe("findArtistMentions", () => {
  it("reads the cues the issue names: like X, more X, X-style", () => {
    expect(namesIn("like Nadia Okoro")).toEqual(["Nadia Okoro"]);
    expect(namesIn("more Kofi Amarteifio please")).toEqual(["Kofi Amarteifio"]);
    expect(namesIn("something Hana Mori-style")).toEqual(["Hana Mori"]);
    expect(namesIn("music similar to hana mori")).toEqual(["Hana Mori"]);
    expect(namesIn("more from Kofi Amarteifio")).toEqual(["Kofi Amarteifio"]);
    expect(namesIn("Orla Voss vibes")).toEqual(["Orla Voss"]);
  });

  it("takes the longest catalog name after the cue and stops at the words that follow", () => {
    expect(namesIn("like Orla Vossen for a run")).toEqual(["Orla Vossen"]);
    expect(namesIn("like Orla Voss for a run")).toEqual(["Orla Voss"]);
  });

  it("reads two artists joined after one cue, at most three in all", () => {
    expect(namesIn("like Nadia Okoro and Hana Mori")).toEqual(["Nadia Okoro", "Hana Mori"]);
    expect(namesIn("like Nadia Okoro, Hana Mori, Kofi Amarteifio and Orla Voss")).toHaveLength(3);
  });

  it("needs a cue: a bare name in a sentence is not a request for the artist", () => {
    expect(namesIn("a song about kern")).toEqual([]);
    expect(namesIn("Nadia Okoro")).toEqual([]);
  });

  it("does not cross a sentence boundary", () => {
    expect(namesIn("something like. Nadia Okoro")).toEqual([]);
  });

  it("returns where the words were written, so \"Didn't catch\" can drop them", () => {
    expect(findArtistMentions("warm like nadia okro tonight", CATALOG)).toEqual([
      { name: "Nadia Okoro", surface: "nadia okro" },
    ]);
  });

  it("finds nothing in an empty catalog", () => {
    expect(findArtistMentions("like Nadia Okoro", buildArtistNameIndex([]))).toEqual([]);
  });
});

describe("withoutArtistMentions", () => {
  const mention = [{ name: "Nadia Okoro", surface: "Nadia Okoro" }];

  it("drops a phrase that was only the artist and keeps unrelated phrases", () => {
    expect(withoutArtistMentions(["Nadia Okoro", "late drive"], mention)).toEqual(["late drive"]);
  });

  it("keeps what is left of a phrase that held more than the artist", () => {
    expect(withoutArtistMentions(["Nadia Okoro for cooking"], mention)).toEqual(["for cooking"]);
  });

  it("changes nothing without a mention", () => {
    expect(withoutArtistMentions(["Nadia Okoro"], [])).toEqual(["Nadia Okoro"]);
  });
});

describe("sanitizeArtistNames", () => {
  it("keeps bounded, distinct strings and ignores everything else", () => {
    expect(sanitizeArtistNames(["A Name", "a name", 3, null, "", "x".repeat(65), "B", "C", "D"])).toEqual([
      "A Name",
      "B",
      "C",
    ]);
    expect(sanitizeArtistNames("A Name")).toEqual([]);
    expect(sanitizeArtistNames(undefined)).toEqual([]);
  });
});

describe("unitCentroid", () => {
  it("averages vectors to unit length", () => {
    const centroid = unitCentroid([[1, 0], [0, 1]]) as number[];
    expect(centroid[0]).toBeCloseTo(Math.SQRT1_2);
    expect(centroid[1]).toBeCloseTo(Math.SQRT1_2);
  });

  it("is null with nothing usable", () => {
    expect(unitCentroid([])).toBeNull();
    expect(unitCentroid([[1, -1], [-1, 1]])).toBeNull();
    expect(unitCentroid([[Number.NaN, 1]])).toBeNull();
  });
});
