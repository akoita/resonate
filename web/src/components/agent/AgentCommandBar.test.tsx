import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AgentCommandBar from "./AgentCommandBar";

describe("AgentCommandBar", () => {
  it("shows the name and an inactive state, with no button, while idle", () => {
    const html = renderToStaticMarkup(<AgentCommandBar name="Night DJ" isLive={false} onStop={vi.fn()} />);
    expect(html).toContain("Night DJ");
    expect(html).toContain("Inactive");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Start Session");
  });

  it("shows the live state and a Stop button, but never a start button, while live", () => {
    const html = renderToStaticMarkup(<AgentCommandBar name="Night DJ" isLive onStop={vi.fn()} />);
    expect(html).toContain("Live");
    expect(html).toContain("Stop Session");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain("Start Session");
  });
});
