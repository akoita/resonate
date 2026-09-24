/**
 * Home v3 Tuner — grouped filter chips, the stable SSR greeting, the energy
 * caption, and a real deck action for every filter (no dead buttons).
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeTuner, greetingForHour, type TunerFilter } from "./HomeTuner";

const FILTERS: TunerFilter[] = [
  { id: "all", label: "All Trending", kind: "all" },
  { id: "jazz", label: "Jazz", kind: "genre", energy: "low" },
  { id: "hip-hop", label: "Hip-Hop", kind: "genre", energy: "high" },
  { id: "focus", label: "Focus", kind: "mood", energy: "low" },
];

function render(activeId: string, overrides: { matchCount?: number; starting?: boolean } = {}) {
  return renderToStaticMarkup(
    <HomeTuner
      filters={FILTERS}
      activeId={activeId}
      onSelect={() => undefined}
      matchCount={overrides.matchCount ?? 0}
      starting={overrides.starting ?? false}
      onStartSession={() => undefined}
    />,
  );
}

describe("HomeTuner", () => {
  it("shows the Open AI DJ link for the all filter", () => {
    const html = render("all");
    expect(html).toContain('href="/agent"');
    expect(html).toContain("Open AI DJ");
    expect(html).not.toContain("session</button>");
    expect(html).toContain("Pick a genre or mood");
    expect(html).toContain("Energy · Medium");
  });

  it("shows the Start session button for a genre or mood filter", () => {
    const html = render("hip-hop", { matchCount: 3 });
    expect(html).toContain("Start Hip-Hop session");
    expect(html).not.toContain("Open AI DJ");
    expect(html).toContain("3 catalog matches for Hip-Hop.");
    expect(html).toContain("Energy · High");
    expect(html).toContain('data-energy="high"');
  });

  it("disables the session button while starting", () => {
    const html = render("focus", { matchCount: 1, starting: true });
    expect(html).toContain("Starting…");
    expect(html).toMatch(/<button type="button" class="ng-btn ng-btn--primary ng-tuner__action" disabled="">/);
    expect(html).toContain("1 catalog match for Focus.");
  });

  it("groups chips under a labelled filter group with pressed state", () => {
    const html = render("jazz");
    expect(html).toContain('role="group" aria-label="Filter trending"');
    expect(html).toContain(">Genre<");
    expect(html).toContain(">Mood<");
    expect(html).toContain('aria-pressed="true" class="ng-chip ng-chip--active">Jazz</button>');
    expect(html).toContain('aria-pressed="false" class="ng-chip ">All Trending</button>');
  });

  it("renders a stable greeting on the server and maps hours to greetings", () => {
    expect(render("all")).toContain("Tune your home");
    expect(greetingForHour(6)).toBe("Good morning");
    expect(greetingForHour(13)).toBe("Good afternoon");
    expect(greetingForHour(20)).toBe("Good evening");
    expect(greetingForHour(23)).toBe("Late night");
    expect(greetingForHour(2)).toBe("Late night");
  });
});
