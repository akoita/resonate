import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UsageLimit } from "../../lib/api";
import { UsageLimitMeter } from "./UsageLimitMeter";

const NOW = Date.parse("2026-10-24T12:00:00.000Z");

function limit(overrides: Partial<UsageLimit> = {}): UsageLimit {
  return {
    kind: "remix_draft",
    label: "AI remix draft",
    remaining: 7,
    limit: 10,
    percentLeft: 70,
    windowSeconds: 3600,
    resetsAt: "2026-10-24T12:30:00.000Z",
    ...overrides,
  };
}

describe("UsageLimitMeter — row", () => {
  it("shows % left, the count, the window and the reset time", () => {
    const html = renderToStaticMarkup(<UsageLimitMeter limit={limit()} now={NOW} />);
    expect(html).toContain("AI remix draft");
    expect(html).toContain("70% left");
    expect(html).toContain("7 / 10 per hour");
    expect(html).toContain("resets in 30 min");
    expect(html).toContain('aria-valuenow="70"');
    expect(html).toContain("width:70%");
  });

  it("shows an em dash for the reset time when the window is idle", () => {
    const html = renderToStaticMarkup(
      <UsageLimitMeter limit={limit({ resetsAt: null, remaining: 10, percentLeft: 100 })} now={NOW} />,
    );
    expect(html).toContain("100% left");
    expect(html).toContain("—");
  });

  it("flags a depleted window", () => {
    const html = renderToStaticMarkup(
      <UsageLimitMeter limit={limit({ remaining: 0, percentLeft: 0 })} now={NOW} />,
    );
    expect(html).toContain('data-status="exhausted"');
    expect(html).toContain('data-depleted="true"');
    expect(html).toContain("0% left");
  });

  it("renders nothing without a limit", () => {
    expect(renderToStaticMarkup(<UsageLimitMeter limit={null} />)).toBe("");
  });
});

describe("UsageLimitMeter — inline", () => {
  it("renders one compact line with % left and the reset time", () => {
    const html = renderToStaticMarkup(
      <UsageLimitMeter variant="inline" limit={limit()} now={NOW} />,
    );
    expect(html).toContain("AI remix draft limit");
    expect(html).toContain("70% left");
    expect(html).toContain("7 of 10 per hour");
    expect(html).toContain("resets in 30 min");
    expect(html).not.toContain("<button");
  });

  it("explains that a reached limit is not a credit problem, with no top-up control", () => {
    const html = renderToStaticMarkup(
      <UsageLimitMeter
        variant="inline"
        limit={limit({ remaining: 0, percentLeft: 0 })}
        now={NOW}
      />,
    );
    expect(html).toContain("Limit reached");
    expect(html).toContain("not a credit balance");
    expect(html).not.toContain("<button");
  });

  it("shows a loading placeholder while the summary is in flight", () => {
    const html = renderToStaticMarkup(
      <UsageLimitMeter variant="inline" limit={null} loading />,
    );
    expect(html).toContain("Loading…");
  });

  it("renders nothing when unknown and not loading", () => {
    expect(renderToStaticMarkup(<UsageLimitMeter variant="inline" limit={null} />)).toBe("");
  });
});
