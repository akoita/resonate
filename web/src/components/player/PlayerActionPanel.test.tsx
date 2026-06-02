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
  it("groups only immediately useful available actions as primary buttons", () => {
    const grouped = groupPlayerActions(actionState);

    expect(grouped.primaryActions.map((action) => action.key)).toEqual([
      "save",
      "add_to_playlist",
      "inspect_stems",
    ]);
    expect(grouped.unavailableActions.map((action) => action.key)).toEqual([
      "remix",
      "collect_drop",
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
