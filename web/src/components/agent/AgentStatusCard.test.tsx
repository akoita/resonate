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
      onModeChange={() => {}}
      sessionCount={0}
      trackCount={0}
      totalSpend={0}
    />,
  );
}

describe("AgentStatusCard session mode toggle", () => {
  it("hides the Curate/Buy toggle when buyModeEnabled is undefined", () => {
    const html = render(baseConfig);
    expect(html).not.toContain("Buy Stems");
    expect(html).not.toContain("Curate Only");
  });

  it("hides the toggle when buyModeEnabled is false", () => {
    expect(render({ ...baseConfig, buyModeEnabled: false })).not.toContain("Buy Stems");
  });

  it("shows the toggle when buyModeEnabled is true", () => {
    const html = render({ ...baseConfig, buyModeEnabled: true });
    expect(html).toContain("Buy Stems");
    expect(html).toContain("Curate Only");
  });
});
