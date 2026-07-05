import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PlayerTrackActionsResponse } from "../../lib/api";
import { groupPlayerActions, PlayerActionPanel } from "./PlayerActionPanel";

const actionState: PlayerTrackActionsResponse = {
  track: {
    id: "track-1",
    title: "Signal One",
    releaseId: "release-1",
    releaseTitle: "Signals",
    artistId: "artist-1",
    artistName: "Ada Mix",
    genre: "electronic",
    moods: ["focused"],
  },
  recommendation: {
    summary: "Picked for your current listening context.",
    reasons: ["context"],
  },
  actions: [
    {
      key: "remix",
      label: "Remix",
      status: "disabled",
      reason: "Remix rights are not available for this track.",
    },
    {
      key: "save",
      label: "Save",
      status: "available",
      reason: "Add this track to your library.",
    },
    {
      key: "collect_drop",
      label: "Collect",
      status: "planned",
      reason: "No active drop is available for this track.",
    },
    {
      key: "shows_campaign",
      label: "Support a show",
      status: "disabled",
      reason: "No live campaign for this artist right now.",
    },
    {
      key: "inspect_stems",
      label: "Inspect stems",
      status: "available",
      href: "/create?trackId=track-1",
    },
    {
      key: "buy_license",
      label: "Buy/license",
      status: "disabled",
      reason: "No active license is available.",
    },
    { key: "add_to_playlist", label: "Add to playlist", status: "available" },
  ],
};

describe("PlayerActionPanel", () => {
  it("groups available actions as primary buttons and keeps disabled/planned actions locked", () => {
    const grouped = groupPlayerActions(actionState);

    expect(grouped.primaryActions.map((action) => action.key)).toEqual([
      "save",
      "add_to_playlist",
      "inspect_stems",
    ]);
    expect(grouped.unavailableActions.map((action) => action.key)).toEqual([
      "remix",
      "collect_drop",
      "shows_campaign",
      "buy_license",
    ]);
  });

  it("promotes buy/license only when the action is available", () => {
    const grouped = groupPlayerActions({
      ...actionState,
      actions: actionState.actions.map((action) =>
        action.key === "buy_license"
          ? { ...action, status: "available" as const, href: "/marketplace/listing-1" }
          : action,
      ),
    });

    expect(grouped.primaryActions.map((action) => action.key)).toContain("buy_license");
    expect(grouped.unavailableActions.map((action) => action.key)).not.toContain("buy_license");
  });

  it("renders an available Support a show action as an enabled chip with campaign detail", () => {
    const onAction = vi.fn();
    const showActionState: PlayerTrackActionsResponse = {
      ...actionState,
      actions: actionState.actions.map((action) =>
        action.key === "shows_campaign"
          ? {
              ...action,
              status: "available" as const,
              href: "/shows/ada-mix-montreal",
              metadata: {
                campaignId: "campaign-1",
                slug: "ada-mix-montreal",
                title: "Ada Mix",
                city: "Montreal",
                progressPct: 78,
                backerCount: 42,
              },
            }
          : action,
      ),
    };

    const grouped = groupPlayerActions(showActionState);
    const html = renderToStaticMarkup(
      <PlayerActionPanel actionState={showActionState} loading={false} onAction={onAction} />,
    );

    expect(grouped.primaryActions.map((action) => action.key)).toContain("shows_campaign");
    expect(grouped.unavailableActions.map((action) => action.key)).not.toContain("shows_campaign");
    expect(html).toContain("Support a show");
    expect(html).toContain("Ada Mix in Montreal \u00b7 78% funded");
    expect(html).not.toContain("player-action-lockchip--available");
  });

  it("does not double the location when the campaign title already names one", () => {
    const onAction = vi.fn();
    const showActionState: PlayerTrackActionsResponse = {
      ...actionState,
      actions: actionState.actions.map((action) =>
        action.key === "shows_campaign"
          ? {
              ...action,
              status: "available" as const,
              href: "/shows/tiken-brooklyn",
              metadata: {
                campaignId: "campaign-2",
                slug: "tiken-brooklyn",
                title: "Tiken Jah Fakoly in Brooklyn",
                city: "New York",
                progressPct: 0,
                backerCount: 0,
              },
            }
          : action,
      ),
    };

    const html = renderToStaticMarkup(
      <PlayerActionPanel actionState={showActionState} loading={false} onAction={onAction} />,
    );

    expect(html).toContain("Tiken Jah Fakoly in Brooklyn \u00b7 0% funded");
    expect(html).not.toContain("in Brooklyn in New York");
  });

  it("renders unavailable actions as compact lock-chips with reasons in tooltips", () => {
    const html = renderToStaticMarkup(
      <PlayerActionPanel actionState={actionState} loading={false} onAction={vi.fn()} />,
    );

    // Compact chip container instead of the old verbose stacked list.
    expect(html).toContain("player-action-locked");
    // Labels render as chips...
    expect(html).toContain("Remix");
    expect(html).toContain("Collect");
    // ...and the reasons are preserved as tooltips (title attributes).
    expect(html).toContain("Remix rights are not available for this track.");
    expect(html).toContain("No active drop is available for this track.");
    expect(html).toContain("No live campaign for this artist right now.");
    expect(html).toContain("No active license is available.");
  });

  it("renders nothing when there is no action response and it is not loading", () => {
    const html = renderToStaticMarkup(
      <PlayerActionPanel actionState={null} loading={false} onAction={vi.fn()} />,
    );

    expect(html).toBe("");
  });

  it("shows the saved state after the save action succeeds", () => {
    const grouped = groupPlayerActions(actionState, true);
    const html = renderToStaticMarkup(
      <PlayerActionPanel actionState={actionState} loading={false} saved onAction={vi.fn()} />,
    );

    expect(grouped.primaryActions.find((action) => action.key === "save")?.label).toBe("Saved");
    expect(html).toContain("Saved");
    expect(html).toContain("aria-pressed=\"true\"");
  });
});
