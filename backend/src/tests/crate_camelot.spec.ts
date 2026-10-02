/**
 * Crate Digger Camelot helpers (#1962) — pure unit tests.
 */
import {
  camelotNeighbors,
  expandCamelotKeys,
  harmonicRelation,
  normalizeCamelotCode,
  parseKeyToCamelot,
} from "../modules/crates/crate_camelot";
import { camelotCode } from "../modules/ingestion/stem-audio-features";

describe("parseKeyToCamelot", () => {
  it.each([
    ["8A", "8A"],
    ["08a", "8A"],
    ["11B", "11B"],
    ["12b", "12B"],
    [" 1 a ", "1A"],
    ["A minor", "8A"],
    ["a minor", "8A"],
    ["Am", "8A"],
    ["A min", "8A"],
    ["A-minor", "8A"],
    ["F#m", "11A"],
    ["F# minor", "11A"],
    ["F♯ minor", "11A"],
    ["Bb major", "6B"],
    ["Bb", "6B"],
    ["C", "8B"],
    ["C major", "8B"],
    ["CM", "8B"],
    ["Cm", "5A"],
    ["Ebm", "2A"],
    ["D♭ major", "3B"],
    ["Db", "3B"],
    ["C# sharp", null],
    ["A flat major", "4B"],
    ["G sharp minor", "1A"],
  ])("reads %j as %j", (text, expected) => {
    expect(parseKeyToCamelot(text)).toBe(expected);
  });

  it.each(["", "   ", "H minor", "13A", "0A", "9C", "A minor major", "Hello", "8", "x".repeat(200), "A#b"])(
    "rejects %j",
    (text) => {
      expect(parseKeyToCamelot(text)).toBeNull();
    },
  );

  it("rejects non-strings without throwing", () => {
    expect(parseKeyToCamelot(undefined as unknown as string)).toBeNull();
    expect(parseKeyToCamelot(8 as unknown as string)).toBeNull();
    expect(parseKeyToCamelot({} as unknown as string)).toBeNull();
  });

  it("reads enharmonic spellings that the extractor never emits", () => {
    expect(parseKeyToCamelot("Cb major")).toBe(parseKeyToCamelot("B major"));
    expect(parseKeyToCamelot("E# minor")).toBe(parseKeyToCamelot("F minor"));
    expect(parseKeyToCamelot("Fb")).toBe(parseKeyToCamelot("E"));
  });

  it("agrees with the ingestion pipeline's tonic -> Camelot table for all 24 keys", () => {
    const tonics = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    for (const tonic of tonics) {
      for (const mode of ["major", "minor"] as const) {
        const stored = camelotCode({ tonic, mode, confidence: 1 });
        expect(stored).not.toBeNull();
        expect(parseKeyToCamelot(`${tonic} ${mode}`)).toBe(stored);
      }
    }
    expect(parseKeyToCamelot("C major")).toBe("8B");
    expect(parseKeyToCamelot("A minor")).toBe("8A");
  });
});

describe("normalizeCamelotCode", () => {
  it("only accepts Camelot codes", () => {
    expect(normalizeCamelotCode("08a")).toBe("8A");
    expect(normalizeCamelotCode("A minor")).toBeNull();
    expect(normalizeCamelotCode("13A")).toBeNull();
  });
});

describe("camelotNeighbors", () => {
  it("returns the relative key and the adjacent numbers on the same ring", () => {
    expect(camelotNeighbors("8A")).toEqual(["8B", "7A", "9A"]);
    expect(camelotNeighbors("5B")).toEqual(["5A", "4B", "6B"]);
  });

  it("wraps 12 and 1", () => {
    expect(camelotNeighbors("12A")).toEqual(["12B", "11A", "1A"]);
    expect(camelotNeighbors("1B")).toEqual(["1A", "12B", "2B"]);
  });

  it("excludes the code itself and has exactly three distinct neighbours", () => {
    for (let n = 1; n <= 12; n += 1) {
      for (const letter of ["A", "B"]) {
        const code = `${n}${letter}`;
        const neighbors = camelotNeighbors(code);
        expect(neighbors).toHaveLength(3);
        expect(new Set(neighbors).size).toBe(3);
        expect(neighbors).not.toContain(code);
      }
    }
  });

  it("is empty for anything that is not a code", () => {
    expect(camelotNeighbors("A minor")).toEqual([]);
    expect(camelotNeighbors("")).toEqual([]);
  });

  it("accepts a non-canonical spelling of a code", () => {
    expect(camelotNeighbors("08a")).toEqual(camelotNeighbors("8A"));
  });
});

describe("expandCamelotKeys", () => {
  it("returns just the codes without neighbours", () => {
    expect([...expandCamelotKeys(["8A", "9a"], false)].sort()).toEqual(["8A", "9A"]);
  });

  it("adds neighbours of every code and de-duplicates", () => {
    const expanded = expandCamelotKeys(["8A", "9A"], true);
    expect([...expanded].sort()).toEqual(["10A", "7A", "8A", "8B", "9A", "9B"].sort());
  });

  it("ignores values that are not Camelot codes", () => {
    expect(expandCamelotKeys(["nope", "A minor", ""], true).size).toBe(0);
    expect(expandCamelotKeys([], true).size).toBe(0);
  });
});

describe("harmonicRelation", () => {
  it("classifies same, neighbor, clash and unknown", () => {
    expect(harmonicRelation("8A", "8A")).toBe("same");
    expect(harmonicRelation("8A", "08a")).toBe("same");
    expect(harmonicRelation("8A", "8B")).toBe("neighbor");
    expect(harmonicRelation("8A", "9A")).toBe("neighbor");
    expect(harmonicRelation("12A", "1A")).toBe("neighbor");
    expect(harmonicRelation("8A", "3B")).toBe("clash");
    expect(harmonicRelation("8A", "9B")).toBe("clash");
    expect(harmonicRelation(null, "8A")).toBe("unknown");
    expect(harmonicRelation("8A", null)).toBe("unknown");
    expect(harmonicRelation(null, null)).toBe("unknown");
    expect(harmonicRelation("garbage", "8A")).toBe("unknown");
  });

  it("is symmetric", () => {
    for (const a of ["1A", "8A", "12B"]) {
      for (const b of ["2A", "8B", "5A", "12B"]) {
        expect(harmonicRelation(a, b)).toBe(harmonicRelation(b, a));
      }
    }
  });
});
