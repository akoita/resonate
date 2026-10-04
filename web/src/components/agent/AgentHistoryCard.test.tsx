import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentHistoryCard from "./AgentHistoryCard";
import type { AgentSession } from "../../lib/api";

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
});
