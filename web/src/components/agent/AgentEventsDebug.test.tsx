import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentEventsDebug, { isAgentDebugRequested } from "./AgentEventsDebug";

const events = [
  { id: "e1", type: "agent.decision_made", sessionId: "s", message: "Picked 5 tracks", timestamp: "2026-10-23T10:00:00Z", icon: "" },
];

describe("AgentEventsDebug", () => {
  it("reads the debug flag from the query string", () => {
    expect(isAgentDebugRequested("?debug=agent")).toBe(true);
    expect(isAgentDebugRequested("?debug=other")).toBe(false);
    expect(isAgentDebugRequested("")).toBe(false);
  });

  it("renders nothing for listeners by default", () => {
    expect(renderToStaticMarkup(<AgentEventsDebug events={events} />)).toBe("");
  });

  it("lists the raw events when enabled", () => {
    const html = renderToStaticMarkup(<AgentEventsDebug events={events} enabled />);
    expect(html).toContain("agent.decision_made");
    expect(html).toContain("Picked 5 tracks");
    expect(renderToStaticMarkup(<AgentEventsDebug events={[]} enabled />)).toContain("No events yet");
  });
});
