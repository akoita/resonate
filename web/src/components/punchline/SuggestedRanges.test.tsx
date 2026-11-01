import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SuggestedRanges } from "./PunchlineMomentEditor";

const noop = () => undefined;
const current = { startMs: 0, endMs: 8000 };

describe("SuggestedRanges (#1476 slice 3)", () => {
  it("renders nothing until suggestions are requested", () => {
    expect(renderToStaticMarkup(<SuggestedRanges current={current} onPick={noop} />)).toBe("");
  });

  it("shows a loading line, then chips with the range and reason", () => {
    expect(renderToStaticMarkup(<SuggestedRanges state="loading" current={current} onPick={noop} />)).toContain(
      "Listening for standout moments",
    );
    const html = renderToStaticMarkup(
      <SuggestedRanges
        state="ready"
        current={{ startMs: 12000, endMs: 20000 }}
        onPick={noop}
        ranges={[
          { startMs: 12000, endMs: 20000, loudnessDb: -12, liftDb: 18, reason: "lift" },
          { startMs: 40000, endMs: 48000, loudnessDb: -10, liftDb: 0, reason: "peak" },
        ]}
      />,
    );
    expect(html).toContain("Suggested:");
    expect(html).toContain("lift");
    expect(html).toContain("peak");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Lifts 18 dB");
  });

  it("falls back to picking by ear when there is nothing to suggest", () => {
    const html = renderToStaticMarkup(<SuggestedRanges state="ready" ranges={[]} current={current} onPick={noop} />);
    expect(html).toContain("Pick the range by ear");
  });
});
