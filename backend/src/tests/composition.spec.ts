import {
  CompositionValidationError,
  formatIswc,
  normalizeCompositionInput,
  normalizeIpi,
  normalizeIswc,
  publicWriters,
  readStoredWriters,
} from "../modules/composition/composition";
import { csvCell } from "../modules/composition/composition.service";

describe("composition rules (#2669)", () => {
  it("returns null when nothing is entered", () => {
    expect(normalizeCompositionInput(undefined)).toBeNull();
    expect(normalizeCompositionInput({})).toBeNull();
    expect(normalizeCompositionInput({ writers: [], publisher: "  ", iswc: "" })).toBeNull();
  });

  it("normalizes writers, publisher and the work code", () => {
    const data = normalizeCompositionInput({
      writers: [
        { name: "  Ada   Lovelace ", role: "composer", share: "60", society: "SACEM", ipi: "00.123.456.789" },
        { name: "Grace Hopper", role: "lyricist", share: 40 },
      ],
      publisher: " Analytical Songs ",
      iswc: "T-034.524.680-1",
    });
    expect(data).toEqual({
      writers: [
        { name: "Ada Lovelace", role: "composer", share: 60, society: "SACEM", ipi: "00123456789" },
        { name: "Grace Hopper", role: "lyricist", share: 40 },
      ],
      publisher: "Analytical Songs",
      selfPublished: false,
      iswc: "T0345246801",
      coverOrSamples: false,
      coverNote: null,
    });
  });

  it("requires shares to total 100 once any share is given", () => {
    expect(() =>
      normalizeCompositionInput({
        writers: [
          { name: "A", role: "composer", share: 50 },
          { name: "B", role: "lyricist", share: 40 },
        ],
      }),
    ).toThrow("add up to 100%. They add up to 90%");
    expect(() =>
      normalizeCompositionInput({
        writers: [
          { name: "A", role: "composer", share: 100 },
          { name: "B", role: "lyricist" },
        ],
      }),
    ).toThrow("give every writer a share");
    expect(
      normalizeCompositionInput({
        writers: [
          { name: "A", role: "composer", share: 33.33 },
          { name: "B", role: "lyricist", share: 33.33 },
          { name: "C", role: "arranger", share: 33.34 },
        ],
      })?.writers.map((w) => w.share),
    ).toEqual([33.33, 33.33, 33.34]);
  });

  it("allows writers without any shares", () => {
    expect(
      normalizeCompositionInput({ writers: [{ name: "A", role: "composer" }] })?.writers,
    ).toEqual([{ name: "A", role: "composer" }]);
  });

  it.each([
    [{ writers: [{ name: "", role: "composer" }] }, "needs a name"],
    [{ writers: [{ name: "A", role: "producer" }] }, "composer, lyricist or arranger"],
    [{ writers: [{ name: "A", role: "composer", share: 0 }] }, "more than 0"],
    [{ writers: [{ name: "A", role: "composer", share: 100.001 }] }, "more than 0 and at most 100"],
    [{ writers: [{ name: "A", role: "composer", share: 99.999 }] }, "two decimals"],
    [{ writers: [{ name: "A", role: "composer", society: "XYZ" }] }, "society from the list"],
    [{ writers: "A" }, "must be a list"],
    [{ writers: Array.from({ length: 21 }, () => ({ name: "A", role: "composer" })) }, "at most 20"],
    [{ iswc: "T-034.524.680-2" }, "check digit"],
    [{ iswc: "034524680" }, "must look like"],
    [{ publisher: "x".repeat(201) }, "at most 200"],
  ])("rejects %j", (input, message) => {
    expect(() => normalizeCompositionInput(input)).toThrow(CompositionValidationError);
    expect(() => normalizeCompositionInput(input)).toThrow(message);
  });

  it("drops the publisher when self-published and the note without the declaration", () => {
    const data = normalizeCompositionInput({
      selfPublished: true,
      publisher: "Ignored",
      coverOrSamples: false,
      coverNote: "ignored",
    });
    expect(data).toMatchObject({ selfPublished: true, publisher: null, coverNote: null });
    expect(normalizeCompositionInput({ coverOrSamples: true, coverNote: " Samples a 1970 drum break " })).toMatchObject({
      coverOrSamples: true,
      coverNote: "Samples a 1970 drum break",
    });
  });

  it("checks code formats", () => {
    expect(normalizeIswc("t0345246801")).toBe("T0345246801");
    expect(formatIswc("T0345246801")).toBe("T-034.524.680-1");
    expect(normalizeIpi("123456789")).toBe("123456789");
    expect(() => normalizeIpi("12345678")).toThrow("9 to 11 digits");
    expect(() => normalizeIpi("1234567890AB")).toThrow("9 to 11 digits");
  });

  it("reads stored writers defensively and exposes names and roles only", () => {
    const stored = readStoredWriters([
      { name: "A", role: "composer", share: 100, ipi: "123456789", society: "PRS" },
      { name: "", role: "composer" },
      "junk",
    ]);
    expect(stored).toHaveLength(1);
    expect(publicWriters(stored)).toEqual([{ name: "A", role: "composer" }]);
    expect(readStoredWriters(null)).toEqual([]);
  });
});

describe("usage export cells", () => {
  it("quotes separators and neutralizes spreadsheet formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell(12)).toBe("12");
    expect(csvCell(null)).toBe("");
  });
});
