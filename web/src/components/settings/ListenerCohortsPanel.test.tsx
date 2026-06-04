import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CommunityCohort, CommunityCohortDetailResponse, CommunityCohortSuggestionsResponse } from "../../lib/api";
import {
  cohortPrimaryAction,
  cohortReasonLabel,
  cohortTypeLabel,
  hasVisibleSelectedCohort,
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

function detail(overrides: Partial<CommunityCohortDetailResponse> = {}): CommunityCohortDetailResponse {
  return {
    schemaVersion: "community-cohort-detail/v1",
    cohort: {
      id: "cohort-1",
      cohortType: "taste",
      reasonCode: "taste:ambient",
      title: "Ambient night listeners",
      safeExplanation: "A privacy-safe group for listeners exploring ambient releases.",
      memberCountLabel: "10+ listeners",
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
    },
    context: {
      signalLabel: "Shared listening signal",
      reasonCode: "taste:ambient",
      memberCountLabel: "10+ listeners",
      visibility: "suggested_or_joined_members_only",
      status: "suggested",
    },
    actions: [
      {
        id: "browse_marketplace",
        label: "Browse marketplace",
        description: "Explore stems and releases while this cohort context is fresh.",
        href: "/marketplace",
        status: "available",
      },
    ],
    redactions: [
      "Other listener identities are hidden.",
      "Wallet addresses and exact private membership details are not exposed.",
      "Raw listening history is never shown on cohort detail.",
    ],
    privacy: {
      minimumSizeEnforced: true,
      memberCountsAreBucketed: true,
      otherListenerIdentities: "redacted",
      walletAddresses: "redacted",
      rawListeningHistory: "redacted",
      visibilityScope: "authenticated_visible_membership",
    },
    ...overrides,
  };
}

function contentProps(overrides: Partial<React.ComponentProps<typeof ListenerCohortsContent>> = {}) {
  return {
    suggestions: suggestions([]),
    selectedCohortId: null,
    detail: null,
    loading: false,
    detailLoading: false,
    detailError: null,
    consentEnabled: true,
    actionId: null,
    onRefresh: vi.fn(),
    onOpenDetail: vi.fn(),
    onCloseDetail: vi.fn(),
    onJoin: vi.fn(),
    onLeave: vi.fn(),
    onHide: vi.fn(),
    ...overrides,
  };
}

describe("ListenerCohortsPanel", () => {
  it("renders disabled-consent guidance before showing cohort actions", () => {
    const html = renderToStaticMarkup(
      <ListenerCohortsContent {...contentProps({
        suggestions: suggestions([cohort()]),
        consentEnabled: false,
      })} />,
    );

    expect(html).toContain("Community matching is off");
    expect(html).not.toContain(">Join</button>");
  });

  it("renders suggested cohorts with safe explanations and join/hide actions", () => {
    const html = renderToStaticMarkup(
      <ListenerCohortsContent {...contentProps({
        suggestions: suggestions([cohort()]),
      })} />,
    );

    expect(html).toContain("Ambient night listeners");
    expect(html).toContain("A privacy-safe group for listeners exploring ambient releases.");
    expect(html).toContain("18+ listeners");
    expect(html).toContain("Shared listening signal");
    expect(html).not.toContain("taste:ambient");
    expect(html).toContain("Details");
    expect(html).toContain("Join");
    expect(html).toContain("Hide");
  });

  it("locks all actions on a cohort while one action is pending", () => {
    const html = renderToStaticMarkup(
      <ListenerCohortsContent {...contentProps({
        suggestions: suggestions([cohort()]),
        actionId: "join:cohort-1",
      })} />,
    );

    expect(html).toMatch(/<button[^>]*disabled[^>]*>Joining\.\.\.<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Hide<\/button>/);
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
      <ListenerCohortsContent {...contentProps({
        suggestions: suggestions([joined]),
      })} />,
    );

    expect(cohortPrimaryAction(joined)).toBe("leave");
    expect(html).toContain("Leave");
    expect(html).not.toContain("Hide");
  });

  it("renders left cohorts with rejoin and hide actions", () => {
    const left = cohort({
      membership: {
        status: "left",
        suggestedAt: "2026-06-01T00:00:00.000Z",
        joinedAt: "2026-06-01T01:00:00.000Z",
        leftAt: "2026-06-02T01:00:00.000Z",
        hiddenAt: null,
      },
    });
    const html = renderToStaticMarkup(
      <ListenerCohortsContent {...contentProps({
        suggestions: suggestions([left]),
      })} />,
    );

    expect(cohortPrimaryAction(left)).toBe("join");
    expect(html).toContain("Rejoin");
    expect(html).toContain("Hide");
  });

  it("shows an empty state when all cohorts are hidden or unavailable", () => {
    const html = renderToStaticMarkup(
      <ListenerCohortsContent {...contentProps({
        suggestions: suggestions([
          cohort({
            membership: {
              status: "hidden",
              suggestedAt: "2026-06-01T00:00:00.000Z",
              joinedAt: null,
              leftAt: null,
              hiddenAt: "2026-06-01T01:00:00.000Z",
            },
          }),
        ]),
      })} />,
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

  it("detects when a selected cohort is no longer visible after refresh", () => {
    const hidden = cohort({
      membership: {
        status: "hidden",
        suggestedAt: "2026-06-01T00:00:00.000Z",
        joinedAt: null,
        leftAt: null,
        hiddenAt: "2026-06-01T01:00:00.000Z",
      },
    });

    expect(hasVisibleSelectedCohort([cohort()], "cohort-1")).toBe(true);
    expect(hasVisibleSelectedCohort([cohort({ id: "cohort-2" })], "cohort-1")).toBe(false);
    expect(hasVisibleSelectedCohort([hidden], "cohort-1")).toBe(false);
    expect(hasVisibleSelectedCohort([], null)).toBe(true);
  });

  it("renders selected cohort detail with music action and redaction copy", () => {
    const html = renderToStaticMarkup(
      <ListenerCohortsContent {...contentProps({
        suggestions: suggestions([cohort()]),
        selectedCohortId: "cohort-1",
        detail: detail(),
      })} />,
    );

    expect(html).toContain("Cohort detail");
    expect(html).toContain("Browse marketplace");
    expect(html).toContain("href=\"/marketplace\"");
    expect(html).toContain("10+ listeners");
    expect(html).toContain("Other listener identities are hidden.");
    expect(html).toContain("Wallet addresses and exact private membership details are not exposed.");
    expect(html).not.toContain("visibleMemberCount");
    expect(html).not.toContain("minimumSize");
  });

  it("renders detail unavailable state when the backend no longer exposes a cohort", () => {
    const html = renderToStaticMarkup(
      <ListenerCohortsContent {...contentProps({
        suggestions: suggestions([cohort()]),
        selectedCohortId: "cohort-1",
        detailError: "This cohort is no longer available for your current visibility settings.",
      })} />,
    );

    expect(html).toContain("Cohort detail unavailable");
    expect(html).toContain("This cohort is no longer available");
  });

  it("renders detail loading state before aggregate context is available", () => {
    const html = renderToStaticMarkup(
      <ListenerCohortsContent {...contentProps({
        suggestions: suggestions([cohort()]),
        selectedCohortId: "cohort-1",
        detailLoading: true,
      })} />,
    );

    expect(html).toContain("Loading cohort detail...");
    expect(html).toContain("Loading privacy-safe cohort context...");
    expect(html).not.toContain("Browse marketplace");
  });
});
