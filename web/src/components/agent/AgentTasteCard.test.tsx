import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentTasteCard from "./AgentTasteCard";
import type { AgentConfig } from "../../lib/api";

const baseConfig = {
  id: "agent-1",
  name: "test-dj",
  userId: "user-1",
  vibes: ["Hip Hop"],
  monthlyCapUsd: 10,
  spentUsd: 0,
  isActive: true,
  sessionMode: "curate",
  stemTypes: [],
  identityStatus: "local",
  tasteScore: 42,
  learnedTasteProfile: {
    score: 42,
    tier: "Explorer",
    signals: 12,
    acceptanceRate: 0.5,
    genresExplored: ["Hip Hop"],
    favoredGenres: [],
  },
} as unknown as AgentConfig;

function render(config: AgentConfig) {
  return renderToStaticMarkup(
    <AgentTasteCard
      config={config}
      onMintIdentity={async () => {}}
      onAttestReputation={async () => {}}
    />,
  );
}

// ADR-TE-6: ERC-8004 identity and reputation publishing is frozen behind the
// backend ERC8004_ENABLED flag, surfaced to the client as `erc8004Enabled`.
describe("AgentTasteCard ERC-8004 gating", () => {
  it.each([
    ["undefined", undefined],
    ["false", false],
  ])("hides identity mint and attest controls when erc8004Enabled is %s", (_label, flag) => {
    const html = render({ ...baseConfig, erc8004Enabled: flag });

    expect(html).not.toContain("Portable Identity");
    expect(html).not.toContain("Mint");
    expect(html).not.toContain("Attest");
    expect(html).not.toContain("ERC-8004");
    expect(html).not.toContain(">local<");
  });

  it("keeps the learned taste score and tier visible when the flag is off", () => {
    const html = render({ ...baseConfig, erc8004Enabled: false });

    expect(html).toContain("Taste Score");
    expect(html).toContain("Explorer");
    expect(html).toContain("12 signals learned");
  });

  it("shows identity mint and attest controls when erc8004Enabled is true", () => {
    const html = render({ ...baseConfig, erc8004Enabled: true });

    expect(html).toContain("Portable Identity");
    expect(html).toContain("Mint");
    expect(html).toContain("Attest");
    expect(html).toContain("ERC-8004");
  });
});

// ADR-TE-1.4: autonomous buying is removed, so there is no stem-type buy filter.
describe("AgentTasteCard stem types", () => {
  it("never renders the stem types to buy panel", () => {
    const html = render(baseConfig);

    expect(html).not.toContain("Stem Types to Buy");
    expect(html).not.toContain("buys every listed stem");
  });
});
