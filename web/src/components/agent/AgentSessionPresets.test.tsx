import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentSessionPresets, { SESSION_PRESETS } from "./AgentSessionPresets";

describe("AgentSessionPresets", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders compact session intent cards without decorative orb copy", () => {
    const html = renderToStaticMarkup(<AgentSessionPresets compact />);

    expect(html).toContain("AI DJ Session Intent");
    expect(html).toContain("Tell the DJ what this session is for.");
    expect(html).toContain("Open AI DJ");
    expect(html).not.toContain("mystery orb");
    expect(html.match(/<article/g)?.length).toBe(SESSION_PRESETS.length);
  });

  it("marks the selected intent and exposes start actions when wired", () => {
    const html = renderToStaticMarkup(
      <AgentSessionPresets
        selectedIntent="Hype"
        showOpenLink={false}
        onSelect={() => {}}
        onStart={() => {}}
      />,
    );

    expect(html).toContain("agent-session-card selected");
    expect(html).toContain("Start with this");
    expect(html).toContain("Buy-ready stems");
    expect(html).not.toContain("Open AI DJ");
  });
});
