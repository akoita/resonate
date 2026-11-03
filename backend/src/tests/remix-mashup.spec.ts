/**
 * remix-mashup/v1 recipe (#2558): validation, rounding and tolerant reads.
 */
import {
  MASHUP_TEMPO_RATIO_MAX,
  MASHUP_TEMPO_RATIO_MIN,
  mashupChanged,
  normalizeRemixMashupInput,
  parseRemixMashup,
  RemixMashupValidationError,
} from "../modules/remix/remix-mashup";

const secondary = { tempoRatio: 1.2, semitones: -2, offsetBars: 4 };

describe("remix-mashup/v1", () => {
  it("normalizes a valid recipe and fills the schema version", () => {
    expect(
      normalizeRemixMashupInput({
        secondary: { ...secondary, tempoRatio: 1.23456789, firstBeatSec: 0.1234567 },
      }),
    ).toEqual({
      schemaVersion: "remix-mashup/v1",
      secondary: { tempoRatio: 1.234568, semitones: -2, offsetBars: 4, firstBeatSec: 0.123457 },
    });
    expect(normalizeRemixMashupInput(null)).toBeNull();
  });

  it("accepts the edges of the stretch range and refuses beyond them (D5)", () => {
    for (const tempoRatio of [MASHUP_TEMPO_RATIO_MIN, MASHUP_TEMPO_RATIO_MAX]) {
      expect(normalizeRemixMashupInput({ secondary: { ...secondary, tempoRatio } })?.secondary.tempoRatio).toBe(tempoRatio);
    }
    for (const tempoRatio of [0.74, 1.34, Number.NaN, "1.2"]) {
      expect(() => normalizeRemixMashupInput({ secondary: { ...secondary, tempoRatio } })).toThrow(
        RemixMashupValidationError,
      );
    }
  });

  it.each([
    [{ ...secondary, semitones: 1.5 }],
    [{ ...secondary, semitones: 7 }],
    [{ ...secondary, offsetBars: -1 }],
    [{ ...secondary, offsetBars: 2001 }],
    [{ ...secondary, firstBeatSec: -0.1 }],
    [{ ...secondary, firstBeatSec: 121 }],
  ])("refuses %j", (bad) => {
    expect(() => normalizeRemixMashupInput({ secondary: bad })).toThrow(RemixMashupValidationError);
  });

  it("refuses the wrong shape or schema version", () => {
    expect(() => normalizeRemixMashupInput([])).toThrow(RemixMashupValidationError);
    expect(() => normalizeRemixMashupInput({})).toThrow(RemixMashupValidationError);
    expect(() =>
      normalizeRemixMashupInput({ schemaVersion: "remix-mashup/v2", secondary }),
    ).toThrow(RemixMashupValidationError);
  });

  it("reads stored rows tolerantly and detects changes", () => {
    expect(parseRemixMashup({ secondary: { ...secondary, tempoRatio: 9 } })).toBeNull();
    const stored = parseRemixMashup({ secondary });
    expect(stored?.secondary).toEqual(secondary);
    expect(mashupChanged(stored, stored)).toBe(false);
    expect(mashupChanged(null, stored)).toBe(false);
    expect(mashupChanged(normalizeRemixMashupInput({ secondary: { ...secondary, offsetBars: 8 } }), stored)).toBe(true);
  });
});
