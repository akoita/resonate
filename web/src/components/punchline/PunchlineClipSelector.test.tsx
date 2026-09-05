import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  clampClipRange,
  formatClipDuration,
  formatClipTime,
  PunchlineClipSelector,
  validateClipRange,
} from "./PunchlineClipSelector";

const MIN = 2000;
const MAX = 15000;
const DURATION_MS = 30000;

describe("validateClipRange", () => {
  it("accepts a well-formed in-bounds range", () => {
    expect(
      validateClipRange({ startMs: 4000, endMs: 10000 }, DURATION_MS, MIN, MAX),
    ).toEqual({ valid: true });
  });

  it("rejects a reversed range", () => {
    const result = validateClipRange(
      { startMs: 8000, endMs: 4000 },
      DURATION_MS,
      MIN,
      MAX,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/before the end/i);
  });

  it("rejects a negative start", () => {
    const result = validateClipRange(
      { startMs: -500, endMs: 4000 },
      DURATION_MS,
      MIN,
      MAX,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a zero-length range", () => {
    const result = validateClipRange(
      { startMs: 4000, endMs: 4000 },
      DURATION_MS,
      MIN,
      MAX,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a clip shorter than the minimum with a human message", () => {
    const result = validateClipRange(
      { startMs: 4000, endMs: 5000 },
      DURATION_MS,
      MIN,
      MAX,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/too short/i);
    expect(result.reason).toMatch(/between 2s and 15s/i);
  });

  it("rejects a clip longer than the maximum with a human message", () => {
    const result = validateClipRange(
      { startMs: 0, endMs: 20000 },
      DURATION_MS,
      MIN,
      MAX,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/too long/i);
    expect(result.reason).toMatch(/between 2s and 15s/i);
  });

  it("rejects a range that extends past the vocals length", () => {
    const result = validateClipRange(
      { startMs: 26000, endMs: 31000 },
      DURATION_MS,
      MIN,
      MAX,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/past the end/i);
  });

  it("allows the end within the source tolerance", () => {
    const result = validateClipRange(
      { startMs: 20000, endMs: DURATION_MS + 40 },
      DURATION_MS,
      MIN,
      MAX,
    );
    expect(result.valid).toBe(true);
  });
});

describe("clampClipRange", () => {
  it("clamps endpoints into [0, duration] and orders them", () => {
    expect(
      clampClipRange({ startMs: 12000, endMs: 4000 }, DURATION_MS, MIN, MAX),
    ).toEqual({ startMs: 4000, endMs: 12000 });
  });

  it("caps an over-long range to the max length", () => {
    const result = clampClipRange(
      { startMs: 0, endMs: 25000 },
      DURATION_MS,
      MIN,
      MAX,
    );
    expect(result.endMs - result.startMs).toBe(MAX);
  });

  it("grows a too-short range to the min length", () => {
    const result = clampClipRange(
      { startMs: 5000, endMs: 5500 },
      DURATION_MS,
      MIN,
      MAX,
    );
    expect(result.endMs - result.startMs).toBe(MIN);
  });

  it("keeps the range inside a short stem", () => {
    const shortDuration = 6000;
    const result = clampClipRange(
      { startMs: 0, endMs: 9999 },
      shortDuration,
      MIN,
      MAX,
    );
    expect(result.startMs).toBeGreaterThanOrEqual(0);
    expect(result.endMs).toBeLessThanOrEqual(shortDuration);
  });
});

describe("formatClipTime", () => {
  it("formats milliseconds as m:ss.t", () => {
    expect(formatClipTime(42500)).toBe("0:42.5");
    expect(formatClipTime(65000)).toBe("1:05.0");
    expect(formatClipTime(0)).toBe("0:00.0");
  });

  it("never returns a negative time", () => {
    expect(formatClipTime(-1000)).toBe("0:00.0");
  });
});

describe("formatClipDuration", () => {
  it("formats a compact seconds badge", () => {
    expect(formatClipDuration(6000)).toBe("6.0s");
    expect(formatClipDuration(2500)).toBe("2.5s");
  });
});

describe("PunchlineClipSelector (static markup)", () => {
  it("renders both range handles and the preview control", () => {
    const html = renderToStaticMarkup(
      <PunchlineClipSelector
        stemId="stem_1"
        durationSeconds={30}
        minMs={MIN}
        maxMs={MAX}
        value={{ startMs: 4000, endMs: 10000 }}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Clip start"');
    expect(html).toContain('aria-label="Clip end"');
    expect(html).toContain('role="slider"');
    expect(html).toContain("Preview range");
    // A valid range shows the duration badge as valid, no validation alert.
    expect(html).toContain("is-valid");
    expect(html).not.toContain('role="alert"');
  });

  it("surfaces the validation reason and disables preview for an invalid range", () => {
    const html = renderToStaticMarkup(
      <PunchlineClipSelector
        stemId="stem_1"
        durationSeconds={30}
        minMs={MIN}
        maxMs={MAX}
        value={{ startMs: 4000, endMs: 4500 }}
        onChange={() => {}}
      />,
    );
    expect(html).toMatch(/too short/i);
    expect(html).toContain('role="alert"');
    expect(html).toContain("disabled");
    expect(html).toContain("is-invalid");
  });
});
