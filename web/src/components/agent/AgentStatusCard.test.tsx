import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentStatusCard from "./AgentStatusCard";
import type { AgentConfig } from "../../lib/api";

const baseConfig = {
  id: "agent-1",
  name: "test-dj",
  userId: "user-1",
  vibes: ["Hip Hop"],
  monthlyCapUsd: 10,
  isActive: false,
  sessionMode: "buy",
  stemTypes: [],
  identityStatus: "local",
} as unknown as AgentConfig;

function render(config: AgentConfig) {
  return renderToStaticMarkup(
    <AgentStatusCard
      config={config}
      onToggle={async () => {}}
      onModeChange={() => {}}
      sessionCount={0}
      trackCount={0}
      totalSpend={0}
    />,
  );
}

describe("AgentStatusCard session mode toggle (ADR-TE-1)", () => {
  it("hides the mode toggle while the buy-mode flag is off, even for a stored buy config", () => {
    expect(render(baseConfig)).not.toContain("Buy Stems");
    expect(render({ ...baseConfig, buyModeEnabled: false })).not.toContain("Buy Stems");
  });

  it("shows the mode toggle when the operator enables buy mode", () => {
    const html = render({ ...baseConfig, buyModeEnabled: true });
    expect(html).toContain("Curate Only");
    expect(html).toContain("Buy Stems");
  });
});
