import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ArtistAnalyticsDashboard from "./ArtistAnalyticsDashboard";
import type { ArtistAnalyticsDashboard as ArtistAnalyticsDashboardData } from "../../lib/api";

describe("ArtistAnalyticsDashboard", () => {
  it("renders a loading state", () => {
    const html = renderToStaticMarkup(
      <ArtistAnalyticsDashboard status="loading" days={30} onDaysChange={() => {}} />,
    );

    expect(html).toContain("Artist Analytics");
    expect(html).toContain("analytics-skeleton");
  });

  it("renders an actionable error state", () => {
    const html = renderToStaticMarkup(
      <ArtistAnalyticsDashboard
        status="error"
        days={30}
        message="API 500: BigQuery unavailable"
        onRetry={() => {}}
        onDaysChange={() => {}}
      />,
    );

    expect(html).toContain("Could not load artist metrics");
    expect(html).toContain("API 500: BigQuery unavailable");
    expect(html).toContain("Retry");
  });

  it("renders an empty real-data state without fake metrics", () => {
    const html = renderToStaticMarkup(
      <ArtistAnalyticsDashboard
        status="ready"
        days={30}
        data={{
          ...dashboard,
          summary: {
            ...dashboard.summary,
            totalPlays: 0,
            totalPayoutUsd: 0,
            payoutsByAsset: [],
          },
          tracks: [],
          topTracks: [],
          sources: [],
          protection: {
            totalDecisions: 0,
            releasesWithDecisions: 0,
            marketplaceReadyReleases: 0,
            restrictedReleases: 0,
            blockedReleases: 0,
            routes: [],
          },
          playsOverTime: [],
          trackPerformance: [],
          meta: {
            ...dashboard.meta,
            isEmpty: true,
            freshness: { asOf: null, lagSeconds: null },
          },
        }}
        onDaysChange={() => {}}
      />,
    );

    expect(html).toContain("No plays or payouts in the last 30 days");
    expect(html).toContain("No events yet");
    expect(html).not.toContain("11,480");
    expect(html).not.toContain("3,420");
  });

  it("renders populated metrics, freshness, and real track performance", () => {
    const html = renderToStaticMarkup(
      <ArtistAnalyticsDashboard
        status="ready"
        days={30}
        artistName="Aya Lune"
        data={dashboard}
        onDaysChange={() => {}}
      />,
    );

    expect(html).toContain("Aya Lune Analytics");
    expect(html).toContain("Source:");
    expect(html).toContain("BigQueryFactTable");
    expect(html).toContain("2 hr delayed");
    expect(html).toContain("12,345");
    expect(html).toContain("$87.65");
    expect(html).toContain("Glass City");
    expect(html).toContain("Track Performance");
    expect(html).toContain("Content protection");
    expect(html).toContain("Marketplace Ready");
    expect(html).toContain("Standard Escrow");
    expect(html).toContain("Recommended next actions");
    expect(html).toContain("Promote the track listeners already choose");
    expect(html).toContain("Open community");
  });

  it("renders the no-artist onboarding state", () => {
    const html = renderToStaticMarkup(
      <ArtistAnalyticsDashboard status="no-artist" days={30} onDaysChange={() => {}} />,
    );

    expect(html).toContain("Create an artist profile to see analytics");
    expect(html).toContain("/artist/onboarding");
  });
});

const dashboard: ArtistAnalyticsDashboardData = {
  summary: {
    artistId: "artist-1",
    days: 30,
    totalPlays: 12345,
    totalPayoutUsd: 87.65,
    payoutsByAsset: [
      {
        paymentToken: "0x0000000000000000000000000000000000000000",
        assetId: "base:usdc",
        symbol: "USDC",
        decimals: 6,
        settlementAmount: "87.65",
        settlementAmountUnits: "87650000",
        canonicalAmountUsd: 87.65,
        count: 3,
      },
    ],
  },
  tracks: [],
  topTracks: [
    {
      trackId: "track-1",
      title: "Glass City",
      plays: 9000,
      payoutUsd: 80,
      payoutsByAsset: [],
    },
  ],
  sessions: [],
  sources: [{ source: "web", plays: 12345 }],
  protection: {
    totalDecisions: 3,
    releasesWithDecisions: 2,
    marketplaceReadyReleases: 1,
    restrictedReleases: 1,
    blockedReleases: 0,
    routes: [
      {
        route: "STANDARD_ESCROW",
        decisions: 2,
        releases: 1,
        latestDecisionAt: "2026-05-22T10:00:00.000Z",
      },
      {
        route: "LIMITED_MONITORING",
        decisions: 1,
        releases: 1,
        latestDecisionAt: "2026-05-21T10:00:00.000Z",
      },
    ],
  },
  actions: [
    {
      id: "promote_top_track:track-1",
      type: "promote_top_track",
      title: "Promote the track listeners already choose",
      description: "Glass City is your strongest recent playback signal.",
      reason: "9,000 aggregate plays in the last 30 days.",
      priority: "high",
      confidence: 0.82,
      sourceSignal: {
        category: "playback",
        summary: "Top track by aggregate plays",
        count: 9000,
      },
      cta: {
        label: "Open in player",
        href: "/player?trackId=track-1",
      },
      privacy: {
        aggregateOnly: true,
        thresholdApplied: true,
        minimumThreshold: 5,
      },
    },
    {
      id: "start_listener_community",
      type: "start_listener_community",
      title: "Gather listeners in your community room",
      description: "Recent listener activity is high enough to make a public artist room useful.",
      reason: "12,345 aggregate plays in the last 30 days.",
      priority: "high",
      confidence: 0.8,
      sourceSignal: {
        category: "community",
        summary: "Aggregate playback demand",
        count: 12345,
      },
      cta: {
        label: "Open community",
        href: "/artist/artist-1?tab=community",
      },
      privacy: {
        aggregateOnly: true,
        thresholdApplied: true,
        minimumThreshold: 5,
      },
    },
  ],
  playsOverTime: [
    { date: "2026-05-20", plays: 4000, payoutUsd: 20 },
    { date: "2026-05-21", plays: 8345, payoutUsd: 67.65 },
  ],
  trackPerformance: [
    {
      trackId: "track-1",
      title: "Glass City",
      plays: 9000,
      payoutUsd: 80,
      payoutsByAsset: [
        {
          paymentToken: "0x0000000000000000000000000000000000000000",
          assetId: "base:usdc",
          symbol: "USDC",
          decimals: 6,
          settlementAmount: "80",
          settlementAmountUnits: "80000000",
          canonicalAmountUsd: 80,
          count: 2,
        },
      ],
    },
  ],
  listenerGrowth: {
    status: "unavailable",
    reason: "listener and follower growth events are not available in the current analytics event model",
  },
  export: {
    artistId: "artist-1",
    days: 30,
    totalPlays: 12345,
    totalPayoutUsd: 87.65,
    payoutsByAsset: [],
    generatedAt: "2026-05-22T12:00:00.000Z",
    source: "bigquery",
    freshness: {
      asOf: "2026-05-22T10:00:00.000Z",
      lagSeconds: 7200,
    },
  },
  meta: {
    source: "bigquery",
    generatedAt: "2026-05-22T12:00:00.000Z",
    timeWindow: {
      from: "2026-04-22T12:00:00.000Z",
      to: "2026-05-22T12:00:00.000Z",
      days: 30,
    },
    freshness: {
      asOf: "2026-05-22T10:00:00.000Z",
      lagSeconds: 7200,
    },
    isEmpty: false,
    cache: {
      hit: false,
      ttlSeconds: 60,
    },
  },
};
