import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CommunityCohort, CommunityCohortSuggestionsResponse } from "../../lib/api";
import {
  cohortPrimaryAction,
  cohortReasonLabel,
  cohortTypeLabel,
  ListenerCohortsContent,
} from "./ListenerCohortsPanel";

function cohort(overrides: Partial<CommunityCohort> = {}): CommunityCohort {
  return {
    id: "cohort-1",
    cohortType: "taste",
    reasonCode: "taste:ambient",
    title: "Ambient night listeners",
    safeExplanation: "A privacy-safe group for listeners exploring ambient releases.",
    minimumSize: 5,
    visibleMemberCount: 18,
    memberCountLabel: "18+ listeners",
    status: "suggested",
    membership: {
      status: "suggested",
      suggestedAt: "2026-06-01T00:00:00.000Z",
      joinedAt: null,
      leftAt: null,
      hiddenAt: null,
    },
    expiresAt: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function suggestions(cohorts: CommunityCohort[]): CommunityCohortSuggestionsResponse {
  return {
    schemaVersion: "community-cohort-suggestions/v1",
    cohorts,
    privacy: {
      minimumSizeEnforced: true,
      explanationScope: "cohort_level",
      otherListenerIdentities: "redacted",
    },
  };
}

describe("ListenerCohortsPanel", () => {
  it("renders disabled-consent guidance before showing cohort actions", () => {
    const html = renderToStaticMarkup(
      <ListenerCohortsContent
        suggestions={suggestions([cohort()])}
        loading={false}
        consentEnabled={false}
        actionId={null}
        onRefresh={vi.fn()}
        onJoin={vi.fn()}
        onLeave={vi.fn()}
        onHide={vi.fn()}
      />,
    );

    expect(html).toContain("Community matching is off");
    expect(html).not.toContain(">Join</button>");
  });

  it("renders suggested cohorts with safe explanations and join/hide actions", () => {
    const html = renderToStaticMarkup(
      <ListenerCohortsContent
        suggestions={suggestions([cohort()])}
        loading={false}
        consentEnabled
        actionId={null}
        onRefresh={vi.fn()}
        onJoin={vi.fn()}
        onLeave={vi.fn()}
        onHide={vi.fn()}
      />,
    );

    expect(html).toContain("Ambient night listeners");
    expect(html).toContain("A privacy-safe group for listeners exploring ambient releases.");
    expect(html).toContain("18+ listeners");
    expect(html).toContain("Shared listening signal");
    expect(html).not.toContain("taste:ambient");
    expect(html).toContain("Join");
    expect(html).toContain("Hide");
  });

  it("renders joined cohorts with a leave action and no hide action", () => {
    const joined = cohort({
      membership: {
        status: "joined",
        suggestedAt: "2026-06-01T00:00:00.000Z",
        joinedAt: "2026-06-01T01:00:00.000Z",
        leftAt: null,
        hiddenAt: null,
      },
    });
    const html = renderToStaticMarkup(
      <ListenerCohortsContent
        suggestions={suggestions([joined])}
        loading={false}
        consentEnabled
        actionId={null}
        onRefresh={vi.fn()}
        onJoin={vi.fn()}
        onLeave={vi.fn()}
        onHide={vi.fn()}
      />,
    );

    expect(cohortPrimaryAction(joined)).toBe("leave");
    expect(html).toContain("Leave");
    expect(html).not.toContain("Hide");
  });

  it("shows an empty state when all cohorts are hidden or unavailable", () => {
    const html = renderToStaticMarkup(
      <ListenerCohortsContent
        suggestions={suggestions([
          cohort({
            membership: {
              status: "hidden",
              suggestedAt: "2026-06-01T00:00:00.000Z",
              joinedAt: null,
              leftAt: null,
              hiddenAt: "2026-06-01T01:00:00.000Z",
            },
          }),
        ])}
        loading={false}
        consentEnabled
        actionId={null}
        onRefresh={vi.fn()}
        onJoin={vi.fn()}
        onLeave={vi.fn()}
        onHide={vi.fn()}
      />,
    );

    expect(html).toContain("No cohort suggestions yet");
    expect(html).not.toContain("Ambient night listeners");
  });

  it("labels supported cohort types for compact card metadata", () => {
    expect(cohortTypeLabel("artist_affinity")).toBe("Artist affinity");
    expect(cohortTypeLabel("city_scene")).toBe("City scene");
    expect(cohortTypeLabel("unknown")).toBe("Community");
    expect(cohortReasonLabel(cohort({ cohortType: "campaign" }))).toBe("Campaign community signal");
  });
});
