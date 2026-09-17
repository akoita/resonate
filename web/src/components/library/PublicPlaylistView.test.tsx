/**
 * #1793 — a playlist row for a track that can no longer be streamed.
 *
 * The bug this guards against is silence: a withdrawn track disappearing from
 * the list, leaving the listener with a shorter playlist and no explanation.
 * The suite runs in `node` with no DOM, so the row is asserted through static
 * rendering (see `src/components/settings/DataExportPanel.test.tsx`).
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublicPlaylistTrackRow } from "./PublicPlaylistView";
import { queueableTracks } from "./trackAvailability";
import type { PublicPlaylistTrack } from "../../lib/api";

function track(overrides: Partial<PublicPlaylistTrack> = {}): PublicPlaylistTrack {
  return {
    id: "track-1",
    title: "Night Bus",
    artist: "Mala",
    album: "Blue Hour",
    duration: 214,
    streamPath: "/catalog/releases/r1/tracks/t1/stream",
    artworkPath: null,
    catalogTrackId: "t1",
    releaseId: "r1",
    playable: true,
    ...overrides,
  };
}

const withdrawn = track({
  playable: false,
  availability: { state: "withdrawn", reason: null, withdrawnAt: "2026-09-16T10:00:00.000Z" },
});

describe("public playlist track row (#1793)", () => {
  it("keeps a withdrawn track in the list and says why", () => {
    const html = renderToStaticMarkup(
      <PublicPlaylistTrackRow track={withdrawn} index={0} isCurrent={false} onPlay={() => {}} />,
    );

    expect(html).toContain("Night Bus");
    expect(html).toContain("Unavailable");
    expect(html).toContain("The artist withdrew this from streaming");
  });

  it("makes the withdrawn row genuinely inert, not merely dimmed", () => {
    const html = renderToStaticMarkup(
      <PublicPlaylistTrackRow track={withdrawn} index={0} isCurrent={false} onPlay={() => {}} />,
    );

    expect(html).toContain('aria-disabled="true"');
    // No button role and no tab stop: it cannot be selected for playback.
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('tabindex="0"');
  });

  it("hides the play/queue actions on a row that cannot be played", () => {
    const html = renderToStaticMarkup(
      <PublicPlaylistTrackRow
        track={withdrawn}
        index={0}
        isCurrent={false}
        onPlay={() => {}}
        actions={<button type="button">Add to queue</button>}
      />,
    );

    expect(html).not.toContain("Add to queue");
  });

  it("leaves an available row fully playable, with its actions", () => {
    const html = renderToStaticMarkup(
      <PublicPlaylistTrackRow
        track={track()}
        index={0}
        isCurrent={false}
        onPlay={() => {}}
        actions={<button type="button">Add to queue</button>}
      />,
    );

    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("Add to queue");
    expect(html).not.toContain("Unavailable");
  });

  it("renders every entry while queueing only the playable ones", () => {
    const tracks = [track({ id: "a" }), { ...withdrawn, id: "b" }, track({ id: "c" })];

    const rendered = tracks
      .map((t, index) =>
        renderToStaticMarkup(
          <PublicPlaylistTrackRow track={t} index={index} isCurrent={false} onPlay={() => {}} />,
        ),
      )
      .join("");

    // Three rows on screen…
    expect(rendered.match(/pl-public-track-index/g) ?? []).toHaveLength(3);
    // …two tracks in the queue.
    expect(queueableTracks(tracks).map((t) => t.id)).toEqual(["a", "c"]);
  });
});
