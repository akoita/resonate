import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../components/ui/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import SessionEventsView, { type SessionEventsViewProps } from "./SessionEventsView";
import { sessionEvents } from "../../../../lib/__fixtures__/adminAgentSessions";

function render(overrides: Partial<SessionEventsViewProps> = {}) {
  return renderToStaticMarkup(
    <SessionEventsView state={{ status: "ready", session: sessionEvents() }} onRetry={vi.fn()} {...overrides} />,
  );
}

describe("SessionEventsView (#2259)", () => {
  it("lists the events in the order given, with decisions, coverage and reason codes", () => {
    const html = render();
    expect(html).toContain("<h1>Session events</h1>");
    expect(html.indexOf("Candidates selected")).toBeLessThan(html.indexOf("Pick 1 of 12"));
    expect(html.indexOf("Pick 1 of 12")).toBeLessThan(html.indexOf("Pick 2 of 12"));
    expect(html).toContain("Reason: llm");
    expect(html).toContain("Reason: no tracks");
    expect(html).toContain("Curated by: the AI model");
    expect(html).toContain("9 of 12 picks match genres");
    expect(html).toContain("2 strong matches held back for variety");
    expect(html).toContain("Shorter than the target");
    expect(html).toContain("Model unavailable (timeout), rules used instead");
    expect(html).toContain("Could not fill: genres, energy");
    expect(html).toContain("<code>track-a</code>");
    expect(html).toContain("24 Oct 2026, 12:00 UTC");
  });

  it("flags a field that was left out for not being a plain code", () => {
    expect(render()).toContain("Left out because it was not a plain code: strategy");
  });

  it("shows the session facts, the owner link, and the audit and retention notes", () => {
    const html = render();
    expect(html).toContain("session-1");
    expect(html).toContain('href="/admin/users/11111111-aaaa-bbbb-cccc-000000000001"');
    expect(html).toContain("Not ended");
    expect(html).toContain("4 events");
    expect(html).toContain("Opening this page is logged");
    expect(html).toContain("kept for 730 days");
    expect(html).toContain('href="/admin/agent-sessions"');
  });

  it("says when the owner's session record is gone", () => {
    const html = render({ state: { status: "ready", session: sessionEvents({ userId: null, startedAt: null }) } });
    expect(html).toContain("Session record no longer exists");
    expect(html).not.toContain('href="/admin/users/');
  });

  it("says when the list is capped", () => {
    const html = render({ state: { status: "ready", session: sessionEvents({ truncated: true }) } });
    expect(html).toContain("more events than can be shown");
  });

  it("says when there are no events", () => {
    const html = render({ state: { status: "ready", session: sessionEvents({ events: [], eventCount: 0 }) } });
    expect(html).toContain("No agent events were recorded for this session, or they have expired.");
    expect(html).not.toContain("<table");
  });

  it("covers loading, forbidden, not found, invalid and error", () => {
    expect(render({ state: { status: "loading" } })).toContain("Loading session events");
    expect(render({ state: { status: "forbidden" } })).toContain("Admins only");
    expect(render({ state: { status: "not_found" } })).toContain("Session not found");
    expect(render({ state: { status: "invalid" } })).toContain("This is not a session id");
    const html = render({ state: { status: "error", message: "Boom" } });
    expect(html).toContain("These events could not be loaded");
    expect(html).toContain("Boom");
    expect(html).toContain("Try again");
  });
});
