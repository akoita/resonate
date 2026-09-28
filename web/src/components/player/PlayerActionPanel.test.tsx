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
  library: null,
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
  it("puts every action in a fixed slot, whatever its status", () => {
    const grouped = groupPlayerActions(actionState);

    // Same four main slots and same small row for every track, so switching
    // tracks never reshapes the panel (the console "shake").
    expect(grouped.primaryActions.map((action) => action.key)).toEqual([
      "save",
      "add_to_playlist",
      "inspect_stems",
      "remix",
    ]);
    expect(grouped.secondaryActions.map((action) => action.key)).toEqual([
      "buy_license",
      "shows_campaign",
      "collect_drop",
    ]);
  });

  it("keeps the same slots when availability changes between tracks", () => {
    const everythingAvailable = groupPlayerActions({
      ...actionState,
      actions: actionState.actions.map((action) => ({ ...action, status: "available" as const })),
    });
    const baseline = groupPlayerActions(actionState);

    expect(everythingAvailable.primaryActions.map((a) => a.key)).toEqual(baseline.primaryActions.map((a) => a.key));
    expect(everythingAvailable.secondaryActions.map((a) => a.key)).toEqual(baseline.secondaryActions.map((a) => a.key));
  });

  it("renders an unavailable main action in its slot, dimmed but still explaining itself", () => {
    const onAction = vi.fn();
    const html = renderToStaticMarkup(
      <PlayerActionPanel actionState={actionState} loading={false} onAction={onAction} />,
    );

    expect(html).toMatch(/class="player-action-chip is-unavailable"[^>]*aria-disabled="true"/);
    expect(html).toContain("Remix — Remix rights are not available for this track.");
    // Pressable (the page shows the reason), not a dead disabled button.
    expect(html).not.toMatch(/is-unavailable"[^>]*disabled=""/);
  });

  it("renders an available Support a show action as an accent pill with its progress", () => {
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

    const html = renderToStaticMarkup(
      <PlayerActionPanel actionState={showActionState} loading={false} onAction={onAction} />,
    );

    expect(html).toContain("player-action-lockchip--available");
    expect(html).toContain("Support a show");
    expect(html).toContain("78% funded");
    expect(html).toContain("Ada Mix in Montreal \u00b7 78% funded");
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

  it("keeps the reasons of unavailable actions as tooltips", () => {
    const html = renderToStaticMarkup(
      <PlayerActionPanel actionState={actionState} loading={false} onAction={vi.fn()} />,
    );

    expect(html).toContain("player-action-locked");
    // Labels render in their slots...
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
    // The accessible name must contain the visible label (WCAG 2.5.3 Label in
    // Name), so it extends "Saved" instead of replacing it outright.
    expect(html).toContain("aria-label=\"Saved — remove from library\"");
    expect(html).not.toMatch(/aria-label="Saved — remove from library"[^>]*disabled/);
  });

  it("reserves the loaded panel's two rows while the first actions load", () => {
    const html = renderToStaticMarkup(
      <PlayerActionPanel actionState={null} loading onAction={vi.fn()} />,
    );

    expect(html).toContain("aria-busy=\"true\"");
    expect(html).toContain("player-action-row");
    expect(html).toContain("player-action-locked");
  });

  it("keeps the previous track's layout but makes every chip inert while the next loads", () => {
    const html = renderToStaticMarkup(
      <PlayerActionPanel actionState={actionState} loading stale onAction={vi.fn()} />,
    );

    // Same layout as the loaded panel — no skeleton swap, no jump.
    expect(html).toContain("Inspect stems");
    expect(html).toContain("player-action-locked");
    expect(html).not.toContain("player-action-chip is-loading");
    // …but nothing can act on the wrong track.
    expect(html).toContain("is-stale");
    expect(html).toContain("aria-busy=\"true\"");
    expect(html).not.toContain("player-action-chip--available");
    const chipCount = html.match(/<button/g)?.length ?? 0;
    const disabledCount = html.match(/<button[^>]*disabled=""/g)?.length ?? 0;
    expect(chipCount).toBeGreaterThan(0);
    expect(disabledCount).toBe(chipCount);
  });

  it("gives remix and show-campaign chips their own icons", () => {
    const html = renderToStaticMarkup(
      <PlayerActionPanel
        actionState={{
          ...actionState,
          actions: [
            { key: "remix", label: "Remix", status: "available", href: "/release/release-1" },
            { key: "shows_campaign", label: "Support a show", status: "available", href: "/shows/a" },
          ],
        }}
        loading={false}
        onAction={vi.fn()}
      />,
    );

    // The generic fallback glyph is a lone circle of radius 9.
    expect(html).not.toContain("r=\"9\"");
  });

  it("marks the save chip busy while the library update is in flight", () => {
    const html = renderToStaticMarkup(
      <PlayerActionPanel actionState={actionState} loading={false} saving onAction={vi.fn()} />,
    );

    expect(html).toContain("player-action-chip__spinner");
    expect(html).toContain("aria-busy=\"true\"");
  });
});
