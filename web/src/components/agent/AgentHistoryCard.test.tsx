import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentHistoryCard from "./AgentHistoryCard";
import type { AgentSession, AgentSessionFilters } from "../../lib/api";

function session(): AgentSession {
  return {
    id: "s-1",
    budgetCapUsd: 5,
    spentUsd: 1.5,
    startedAt: "2026-10-02T10:00:00.000Z",
    endedAt: "2026-10-02T10:30:00.000Z",
    agentTransactions: [],
    licenses: [
      {
        id: "lic-1",
        trackId: "t-1",
        type: "remix",
        priceUsd: 0.75,
        recommendation: { reason: "taste_match" },
        track: {
          id: "t-1",
          title: "Night Drive",
          artist: "Ada",
          releaseId: "r-1",
          release: { id: "r-1", title: "Nights", artworkMimeType: null },
        },
      },
    ],
  } as unknown as AgentSession;
}

function emptySession(index: number): AgentSession {
  return {
    id: `session-${index}`,
    budgetCapUsd: 10,
    spentUsd: 0,
    startedAt: new Date(Date.UTC(2026, 9, 1, index)).toISOString(),
    endedAt: new Date(Date.UTC(2026, 9, 1, index, 5)).toISOString(),
    licenses: [],
    agentTransactions: [],
  };
}

const tenSessions = Array.from({ length: 10 }, (_, index) => emptySession(index));

describe("AgentHistoryCard", () => {
  it("lists picked tracks without prices, spend, or license badges (#2036)", () => {
    const html = renderToStaticMarkup(<AgentHistoryCard sessions={[session()]} totalCount={1} isLoading={false} />);

    expect(html).toContain("Night Drive");
    expect(html).toContain("Ada");
    expect(html).toContain("1 track");
    expect(html).not.toContain("$");
    expect(html).not.toMatch(/remix|personal|commercial/i);
  });

  it("shows the lifetime count and a window note when older sessions are not listed", () => {
    const html = renderToStaticMarkup(<AgentHistoryCard sessions={tenSessions} totalCount={34} isLoading={false} />);

    expect(html).toContain('<span class="aid-count-badge">34</span>');
    expect(html).toContain("Showing your 10 most recent of 34 sessions.");
  });

  it("omits the window note when every session is listed", () => {
    const html = renderToStaticMarkup(<AgentHistoryCard sessions={tenSessions} totalCount={10} isLoading={false} />);

    expect(html).toContain('<span class="aid-count-badge">10</span>');
    expect(html).not.toContain("most recent of");
  });

  describe("session filters (#2096)", () => {
    const render = (filters?: AgentSessionFilters | null) =>
      renderToStaticMarkup(
        <AgentHistoryCard sessions={[{ ...emptySession(1), filters }]} totalCount={1} isLoading={false} />,
      );

    it("shows the preset, genres, energy and tempo under the date", () => {
      const html = render({
        presetName: "Night Drive",
        genres: ["Trap", "Soul"],
        moods: ["dark"],
        energy: "high",
        tempoBpm: { min: 90, max: 110 },
        explicit: false,
      });

      expect(html).toContain('<strong class="aid-history-filters-preset">Night Drive</strong>');
      expect(html).toContain("Trap \u00B7 Soul");
      expect(html).toContain("dark");
      expect(html).toContain("Energy high");
      expect(html).toContain("90\u2013110 BPM");
      expect(html).toContain('title="Night Drive \u00B7 Trap \u00B7 Soul \u00B7 dark \u00B7 Energy high \u00B7 90\u2013110 BPM"');
      expect(html.indexOf("aid-history-date")).toBeLessThan(html.indexOf("aid-history-filters"));
      expect(html).not.toContain("Explicit on");
    });

    it("describes open-ended tempo ranges", () => {
      expect(render({ genres: ["House"], moods: [], tempoBpm: { min: 120, max: null }, explicit: false })).toContain(
        "from 120 BPM",
      );
      expect(render({ genres: ["House"], moods: [], tempoBpm: { min: null, max: 100 }, explicit: false })).toContain(
        "up to 100 BPM",
      );
    });

    it("labels My Mix sessions", () => {
      expect(render({ genres: [], moods: [], myMix: true, explicit: false })).toContain("My Mix");
    });

    it("shows Explicit on only when explicit is true", () => {
      expect(render({ genres: ["Rap"], moods: [], explicit: true })).toContain("Explicit on");
      expect(render({ genres: ["Rap"], moods: [], explicit: false })).not.toContain("Explicit");
    });

    it("falls back to Saved taste when no filter was chosen", () => {
      expect(render({ genres: [], moods: [], explicit: false })).toContain("Saved taste");
      const withExplicit = render({ genres: [], moods: [], explicit: true });
      expect(withExplicit).toContain("Saved taste");
      expect(withExplicit).toContain("Explicit on");
    });

    it("renders nothing for older sessions without filters", () => {
      expect(render(null)).not.toContain("aid-history-filters");
      expect(render(undefined)).not.toContain("aid-history-filters");
      expect(render(null)).not.toContain("Saved taste");
    });
  });
});
