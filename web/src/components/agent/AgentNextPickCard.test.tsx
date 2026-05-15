import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentNextPickCard from "./AgentNextPickCard";
import type { AgentConfig } from "../../lib/api";

const config = {
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
} as unknown as AgentConfig;

describe("AgentNextPickCard", () => {
  it("shows an honest no-match state", () => {
    const html = renderToStaticMarkup(
      <AgentNextPickCard
        config={config}
        activeSessionId="session-1"
        isLoading={false}
        pick={{ status: "no_tracks", reason: "no_matching_taste_candidates" }}
        onPick={async () => {}}
      />,
    );

    expect(html).toContain("No matching tracks found for the selected taste profile.");
  });

  it("shows recommendation explanations and audio signal details", () => {
    const html = renderToStaticMarkup(
      <AgentNextPickCard
        config={config}
        activeSessionId="session-1"
        isLoading={false}
        pick={{
          status: "ok",
          track: { id: "track-1", title: "Boom Bap Signal", artistId: "artist-1" },
          licenseType: "personal",
          priceUsd: 0.02,
          runtimeStatus: "approved",
          score: 72,
          explanation: ["Nearby vibe match", "Purchasable stem available"],
          audioFeatures: {
            source: "metadata_inferred",
            energyBand: "high",
            tempoBpm: 124,
            confidence: 0.6,
          },
        }}
        onPick={async () => {}}
      />,
    );

    expect(html).toContain("Boom Bap Signal");
    expect(html).toContain("score 72");
    expect(html).toContain("Nearby vibe match");
    expect(html).toContain("Audio signal: high energy, 124 BPM");
  });
});
