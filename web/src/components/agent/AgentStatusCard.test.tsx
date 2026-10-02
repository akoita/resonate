import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentStatusCard from "./AgentStatusCard";
import type { AgentConfig } from "../../lib/api";

const baseConfig = {
  id: "cfg-1",
  userId: "user-1",
  name: "DJ",
  vibes: ["Ambient"],
  stemTypes: [],
  sessionMode: "curate",
  monthlyCapUsd: 10,
  isActive: false,
} as unknown as AgentConfig;

function render(config: AgentConfig) {
  return renderToStaticMarkup(
    <AgentStatusCard
      config={config}
      onToggle={async () => {}}
      sessionCount={0}
      trackCount={0}
    />,
  );
}

describe("AgentStatusCard session mode", () => {
  it("renders no Curate/Buy toggle", () => {
    const html = render(baseConfig);
    expect(html).not.toContain("Buy Stems");
    expect(html).not.toContain("Curate Only");
  });

  it("renders no Curate/Buy toggle for a legacy stored buy-mode config", () => {
    const html = render({ ...baseConfig, sessionMode: "buy" } as AgentConfig);
    expect(html).not.toContain("Buy Stems");
    expect(html).not.toContain("Curate Only");
  });
});

describe("AgentStatusCard listening stats", () => {
  it("shows sessions and tracks but no spend", () => {
    const html = renderToStaticMarkup(
      <AgentStatusCard config={baseConfig} onToggle={async () => {}} sessionCount={3} trackCount={12} />,
    );
    expect(html).toContain("Sessions");
    expect(html).toContain("Tracks");
    expect(html).not.toContain("Spent");
    expect(html).not.toContain("$");
  });
});
