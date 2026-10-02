import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CrateWatchView, type CrateWatchViewProps } from "./CrateWatchView";
import type { CrateWatch } from "../../lib/crates";

const off: CrateWatch = {
  mode: "off",
  expiresAt: null,
  summary: { month: "2026-10", matches: 0, notified: 0 },
  recentMatches: [],
};

const on: CrateWatch = {
  mode: "notify",
  expiresAt: "2026-12-31T12:00:00.000Z",
  summary: { month: "2026-10", matches: 3, notified: 3 },
  recentMatches: [
    {
      trackId: "t1",
      releaseId: "r1",
      title: "Night Drive",
      artistName: "Ada",
      matchedAt: "2026-10-02T09:00:00.000Z",
    },
    { trackId: "t2", releaseId: null, title: "Loose End", artistName: null, matchedAt: "2026-10-01T09:00:00.000Z" },
  ],
};

function render(overrides: Partial<CrateWatchViewProps> = {}) {
  return renderToStaticMarkup(
    <CrateWatchView
      availability="available"
      watch={off}
      days={90}
      busy={false}
      error={null}
      onDaysChange={vi.fn()}
      onTurnOn={vi.fn()}
      onStop={vi.fn()}
      {...overrides}
    />,
  );
}

describe("CrateWatchView", () => {
  it("offers Off and Notify me with a length for a saved crate that is not watching", () => {
    const html = render();
    expect(html).toContain("Watch for new releases");
    expect(html).toContain("Notify me");
    expect(html).toContain("Watch for");
    expect(html).toContain("Not watching");
    expect(html).toContain("No new matches this month yet");
    expect(html).not.toContain("Stop watching");
    expect(html).toContain("never buys anything");
  });

  it("shows the expiry, the summary, the matches with links and a one-click stop", () => {
    const html = render({ watch: on });
    expect(html).toContain("Watching until Dec 31, 2026");
    expect(html).toContain("Stop watching");
    expect(html).toContain("3 new matches this month");
    expect(html).toContain("Recent matches");
    expect(html).toContain('href="/release/r1"');
    expect(html).toContain("Night Drive by Ada");
    // A match with no release still shows, without a link.
    expect(html).toContain("Loose End");
    expect(html).not.toContain('href="/release/null"');
  });

  it("asks to save a draft instead of showing the control", () => {
    const html = render({ availability: "draft" });
    expect(html).toContain("Save the crate to watch it.");
    expect(html).not.toContain("Notify me");
  });

  it("shows a plain Crate Pro note instead of the control when the entitlement denies", () => {
    const html = render({ availability: "denied" });
    expect(html).toContain("part of Crate Pro");
    expect(html).not.toContain("Notify me");
  });

  it("keeps Stop watching available when a denied crate is still watching", () => {
    const html = render({ availability: "denied", watch: on });
    expect(html).toContain("Stop watching");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Stop watching/);
  });

  it("shows a failure and explains matches that were not notified", () => {
    const html = render({
      watch: { ...on, summary: { month: "2026-10", matches: 25, notified: 20 } },
      error: "Save the crate to watch it.",
    });
    expect(html).toContain("20 of 25 sent a notification");
    expect(html).toContain('role="alert"');
  });

  it("disables the control while a change is in flight", () => {
    expect(render({ busy: true, watch: on })).toMatch(/<button[^>]*disabled[^>]*>Stop watching/);
  });
});
