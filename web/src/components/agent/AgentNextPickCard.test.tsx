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

    expect(html).toContain("Nothing in the catalog matches this session&#x27;s filters yet.");
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
            source: "measured_full_mix",
            energyBand: "high",
            tempoBpm: 124.4,
            featureSources: { tempo: "measured" },
            confidence: 0.6,
          },
        }}
        onPick={async () => {}}
      />,
    );

    expect(html).toContain("Boom Bap Signal");
    expect(html).toContain("score 72");
    expect(html).toContain("Nearby vibe match");
    expect(html).toContain("high energy · 124 BPM");
  });

  it("does not show an inferred tempo as a BPM (#1960)", () => {
    const html = renderToStaticMarkup(
      <AgentNextPickCard
        config={config}
        activeSessionId="session-1"
        isLoading={false}
        pick={{
          status: "ok",
          track: { id: "track-1", title: "Boom Bap Signal", artistId: "artist-1" },
          runtimeStatus: "approved",
          audioFeatures: {
            source: "metadata_inferred",
            energyBand: "high",
            tempoBpm: 124,
            featureSources: { tempo: "inferred" },
          },
        }}
        onPick={async () => {}}
      />,
    );

    expect(html).toContain("high energy");
    expect(html).not.toContain("BPM");
  });

  const okPick = {
    status: "ok",
    track: { id: "track-1", title: "Boom Bap Signal", artistId: "artist-1" },
    licenseType: "personal" as const,
    priceUsd: 0.02,
  };

  it("hides price and license while the DJ only curates", () => {
    const html = renderToStaticMarkup(
      <AgentNextPickCard config={config} activeSessionId="session-1" isLoading={false} pick={okPick} onPick={async () => {}} />,
    );

    expect(html).not.toContain("$0.02");
    expect(html).not.toContain(">personal<");
  });

  it("hides price and license even for a legacy stored buy-mode config", () => {
    const legacyConfig = { ...config, sessionMode: "buy" } as AgentConfig;
    const html = renderToStaticMarkup(
      <AgentNextPickCard config={legacyConfig} activeSessionId="session-1" isLoading={false} pick={okPick} onPick={async () => {}} />,
    );

    expect(html).not.toContain("$0.02");
    expect(html).not.toContain(">personal<");
  });

  it("does not claim a live session while the DJ is inactive", () => {
    const html = renderToStaticMarkup(
      <AgentNextPickCard
        config={{ ...config, isActive: false } as AgentConfig}
        activeSessionId="stale-session"
        isLoading={false}
        pick={null}
        onPick={async () => {}}
      />,
    );

    expect(html).not.toContain("Session Live");
    expect(html).toContain("No Session");
  });
});
