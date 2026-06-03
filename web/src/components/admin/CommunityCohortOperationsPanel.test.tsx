import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CommunityCohortOperationsPanel from "./CommunityCohortOperationsPanel";
import type {
  CommunityCohortGenerationResponse,
  CommunityCohortQualityResponse,
} from "../../lib/api";

describe("CommunityCohortOperationsPanel", () => {
  it("renders restricted admin state", () => {
    const html = renderToStaticMarkup(
      <CommunityCohortOperationsPanel
        status="forbidden"
        minimumSize={5}
        onMinimumSizeChange={() => {}}
      />,
    );

    expect(html).toContain("Community cohort operations are restricted");
    expect(html).toContain("admin account");
  });

  it("renders real-data readiness guidance when generated cohorts are not visible", () => {
    const html = renderToStaticMarkup(
      <CommunityCohortOperationsPanel
        status="ready"
        minimumSize={2}
        quality={{
          ...quality,
          cohorts: {
            ...quality.cohorts,
            generated: {
              ...quality.cohorts.generated,
              total: 1,
              visibleNow: 0,
              belowThreshold: 1,
            },
          },
        }}
        lastGeneration={null}
        isGenerating={false}
        generateError={null}
        onMinimumSizeChange={() => {}}
        onGenerate={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(html).toContain("No visible generated cohorts yet");
    expect(html).toContain("2+ real opted-in listeners");
    expect(html).toContain("Shared safe signal");
    expect(html).toContain("metadata-dot--muted");
    expect(html).not.toContain("mock");
    expect(html).not.toContain("synthetic");
  });

  it("renders generation summary and bounded reason-code aggregates", () => {
    const html = renderToStaticMarkup(
      <CommunityCohortOperationsPanel
        status="ready"
        minimumSize={2}
        quality={quality}
        lastGeneration={generation}
        isGenerating={false}
        generateError={null}
        onMinimumSizeChange={() => {}}
        onGenerate={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(html).toContain("Generate at 2+");
    expect(html).toContain("Ready for listener validation");
    expect(html).toContain("Created memberships");
    expect(html).toContain("Shared Taste");
    expect(html).toContain("1-4");
    expect(html).toContain("Aggregate only");
  });
});

const quality: CommunityCohortQualityResponse = {
  schemaVersion: "community-cohort-quality/v1",
  generatedAt: "2026-06-03T08:00:00.000Z",
  cohorts: {
    total: 2,
    visibleNow: 1,
    belowThreshold: 1,
    byStatus: { active: 1, archived: 1 },
    byType: { taste: 2 },
    generated: {
      total: 2,
      visibleNow: 1,
      belowThreshold: 1,
      byStatus: { active: 1, archived: 1 },
      byType: { taste: 2 },
    },
  },
  memberships: {
    total: 3,
    stale: 1,
    byStatus: { suggested: 2, stale: 1 },
    disabledConsent: { total: 0, byType: {} },
  },
  actions: {
    total: 2,
    byEvent: [{ key: "community.cohort_suggested", count: 2 }],
    source: "analytics_event_ledger",
  },
  reasonCodes: {
    limit: 12,
    total: 1,
    summaries: [
      {
        cohortType: "taste",
        reasonCode: "taste:shared_taste",
        cohortCount: 2,
        activeCount: 1,
        archivedCount: 1,
        expiredCount: 0,
        belowThresholdCount: 1,
        visibleMemberBucket: "1-4",
      },
    ],
  },
  privacy: {
    aggregateOnly: true,
    noListenerIdentifiers: true,
    noWalletAddresses: true,
    noRawListeningHistory: true,
    noFineLocation: true,
    reasonCodesAreBounded: true,
    memberCountsAreBucketed: true,
  },
};

const generation: CommunityCohortGenerationResponse = {
  schemaVersion: "community-cohort-generation/v1",
  generatedAt: "2026-06-03T08:05:00.000Z",
  summary: {
    candidateCohorts: 2,
    cohortsMaterialized: 2,
    cohortsReconciled: 2,
    visibleCohorts: 1,
    cohortsActivated: 1,
    cohortsArchived: 1,
    cohortsExpired: 0,
    membershipsCreated: 2,
    membershipsPreserved: 1,
    hiddenMembershipsPreserved: 0,
    staleMembershipsMarked: 1,
    staleMembershipsRestored: 0,
  },
  cohorts: [],
  privacy: {
    minimumSizeEnforced: true,
    consentGated: true,
    aggregateCountsOnly: true,
    otherListenerIdentities: "redacted",
  },
};
