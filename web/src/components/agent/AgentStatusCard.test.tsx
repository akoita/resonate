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
  spentUsd: 0,
  isActive: false,
  sessionMode: "curate",
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

describe("AgentStatusCard session mode toggle", () => {
  it("hides the Buy Stems toggle when the operator flag is absent", () => {
    const html = render(baseConfig);

    expect(html).not.toContain("Buy Stems");
    expect(html).not.toContain("Curate Only");
  });

  it("hides the Buy Stems toggle when the operator flag is off, even for a stored buy mode", () => {
    const html = render({ ...baseConfig, sessionMode: "buy", sessionBuyModeEnabled: false });

    expect(html).not.toContain("Buy Stems");
  });

  it("shows the toggle only when the operator flag is on", () => {
    const html = render({ ...baseConfig, sessionBuyModeEnabled: true });

    expect(html).toContain("Curate Only");
    expect(html).toContain("Buy Stems");
  });
});
