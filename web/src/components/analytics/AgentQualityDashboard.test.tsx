import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentQualityDashboard from "./AgentQualityDashboard";
import type { AgentQualityDashboard as AgentQualityDashboardData } from "../../lib/api";

describe("AgentQualityDashboard", () => {
  it("renders a loading state", () => {
    const html = renderToStaticMarkup(
      <AgentQualityDashboard status="loading" days={30} onDaysChange={() => {}} />,
    );

    expect(html).toContain("Recommendation Quality");
    expect(html).toContain("Loading AI DJ quality metrics");
  });

  it("renders restricted operator state", () => {
    const html = renderToStaticMarkup(
      <AgentQualityDashboard status="forbidden" days={30} onDaysChange={() => {}} />,
    );

    expect(html).toContain("AI DJ quality metrics are restricted");
  });

  it("renders aggregate quality metrics and privacy boundary", () => {
    const html = renderToStaticMarkup(
      <AgentQualityDashboard status="ready" days={30} data={dashboard} onDaysChange={() => {}} />,
    );

    expect(html).toContain("BigQueryFactTable");
    expect(html).toContain("Acceptance");
    expect(html).toContain("68%");
    expect(html).toContain("First-pick skip");
    expect(html).toContain("Neural Flow");
    expect(html).toContain("Version Freshness");
    expect(html).toContain("baseline/v1");
    expect(html).toContain("actor ids");
  });

  it("renders an empty aggregate state without fake metrics", () => {
    const html = renderToStaticMarkup(
      <AgentQualityDashboard
        status="ready"
        days={30}
        data={{
          ...dashboard,
          summary: {
            ...dashboard.summary,
            sessionsStarted: 0,
            acceptedPicks: 0,
            acceptanceRate: 0,
          },
          intentBreakdown: [],
          strategyBreakdown: [],
          tasteSourceBreakdown: [],
          versionBreakdown: [],
          qualityOverTime: [],
          meta: {
            ...dashboard.meta,
            isEmpty: true,
            freshness: { asOf: null, lagSeconds: null },
          },
        }}
        onDaysChange={() => {}}
      />,
    );

    expect(html).toContain("No AI DJ quality events in this window");
    expect(html).not.toContain("68%");
  });
});

const dashboard: AgentQualityDashboardData = {
  summary: {
    days: 30,
    sessionsStarted: 42,
    sessionsStopped: 38,
    intentSelections: 55,
    nextPickRequests: 100,
    acceptedPicks: 68,
    playbackCompletions: 50,
    firstPickSkips: 9,
    firstPickOutcomes: 50,
    saves: 12,
    playlistAdds: 7,
    purchases: 5,
    purchaseUsd: 24.5,
    averageSessionDurationMs: 540000,
    acceptanceRate: 0.68,
    firstPickSkipRate: 0.18,
    completionRate: 0.7353,
    saveRate: 0.1765,
    playlistAddRate: 0.1029,
    purchaseRate: 0.0735,
  },
  intentBreakdown: [
    {
      key: "focus",
      label: "Neural Flow",
      sessionsStarted: 20,
      nextPickRequests: 50,
      acceptedPicks: 37,
      acceptanceRate: 0.74,
      completionRate: 0.8,
      saveRate: 0.2,
      purchaseRate: 0.08,
      averageSessionDurationMs: 600000,
    },
  ],
  strategyBreakdown: [
    {
      key: "model-assisted",
      label: "Model Assisted",
      sessionsStarted: 42,
      nextPickRequests: 100,
      acceptedPicks: 68,
      acceptanceRate: 0.68,
      completionRate: 0.74,
      saveRate: 0.18,
      purchaseRate: 0.07,
      averageSessionDurationMs: 540000,
    },
  ],
  tasteSourceBreakdown: [],
  versionBreakdown: [
    {
      key: "baseline/v1",
      label: "baseline/v1",
      sessionsStarted: 42,
      nextPickRequests: 100,
      acceptedPicks: 68,
      acceptanceRate: 0.68,
      completionRate: 0.74,
      saveRate: 0.18,
      purchaseRate: 0.07,
      averageSessionDurationMs: 540000,
    },
  ],
  qualityOverTime: [
    {
      date: "2026-05-25",
      sessionsStarted: 12,
      nextPickRequests: 40,
      acceptedPicks: 25,
      completions: 18,
      saves: 6,
      purchases: 2,
    },
  ],
  privacy: {
    aggregation: "event-level aggregate metrics only",
    excludes: ["raw listener history", "actor ids", "wallet addresses", "per-user drilldowns"],
  },
  meta: {
    source: "bigquery",
    generatedAt: "2026-05-27T12:00:00.000Z",
    timeWindow: {
      from: "2026-04-27T12:00:00.000Z",
      to: "2026-05-27T12:00:00.000Z",
      days: 30,
    },
    freshness: {
      asOf: "2026-05-27T10:00:00.000Z",
      lagSeconds: 7200,
    },
    isEmpty: false,
    cache: {
      hit: false,
      ttlSeconds: 60,
    },
  },
};
