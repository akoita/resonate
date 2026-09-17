/**
 * #1793 — the rules that decide whether a saved track can still be played,
 * and what a listener is told when it cannot.
 *
 * The web unit suite runs in a `node` environment with no DOM (see
 * `vitest.config.ts`), so the logic is tested directly and the words are
 * asserted through static rendering, as in
 * `src/components/settings/DataExportPanel.test.tsx`.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  GENERIC_UNAVAILABLE_REASON,
  TrackUnavailableNote,
  WITHDRAWN_REASON,
  isPlayableEntry,
  queueableTracks,
  resolveAvailability,
} from "./trackAvailability";

const WITHDRAWN = {
  playable: false,
  availability: { state: "withdrawn" as const, reason: null, withdrawnAt: "2026-09-16T10:00:00.000Z" },
};

describe("track availability (#1793)", () => {
  it("treats a plain entry as playable", () => {
    expect(resolveAvailability({ playable: true })).toEqual({
      playable: true,
      label: null,
      reason: null,
    });
  });

  it("says in words that the artist withdrew a track, and refuses to play it", () => {
    const resolved = resolveAvailability(WITHDRAWN);

    expect(resolved.playable).toBe(false);
    expect(resolved.label).toBe("Unavailable");
    expect(resolved.reason).toBe(WITHDRAWN_REASON);
    // It must read as reversible, not as a deletion.
    expect(resolved.reason?.toLowerCase()).toContain("may come back");
    expect(resolved.reason?.toLowerCase()).not.toContain("deleted");
  });

  it("passes on the artist's own note when they left one", () => {
    const resolved = resolveAvailability({
      availability: {
        state: "withdrawn",
        reason: "Re-clearing a sample",
        withdrawnAt: "2026-09-16T10:00:00.000Z",
      },
    });

    expect(resolved.reason).toContain("Re-clearing a sample");
  });

  it("keeps a purchase playable even when the catalog withdrew it", () => {
    // Withdrawal stops new streams. It does not reach something already bought,
    // and the UI must never suggest otherwise.
    expect(isPlayableEntry({ ...WITHDRAWN, isOwned: true })).toBe(true);
    expect(resolveAvailability({ ...WITHDRAWN, isOwned: true }).label).toBeNull();
  });

  it("does not let a purchase outrank a takedown", () => {
    // The mirror of the test above, and the harder half. A withdrawal is the
    // artist's choice and a purchase survives it. A rights removal is not
    // anyone's choice: it obliges us to stop serving the material, and "they
    // bought it" is not an answer to that. Their downloaded copy is beyond our
    // reach; what we still stream is not.
    const owned = { isOwned: true } as const;
    expect(
      isPlayableEntry({ ...owned, availability: { state: "unavailable", reason: "rights_removed" } }),
    ).toBe(false);
    expect(
      isPlayableEntry({ ...owned, availability: { state: "unavailable", reason: "under_review" } }),
    ).toBe(false);

    // Everything else still yields to ownership — a purchase is not revoked by
    // a release merely being unpublished or geo-restricted.
    expect(
      isPlayableEntry({ ...owned, availability: { state: "unavailable", reason: "not_published" } }),
    ).toBe(true);
    expect(
      isPlayableEntry({ ...owned, availability: { state: "unavailable", reason: "restricted" } }),
    ).toBe(true);
  });

  it("turns the server's machine reason into words a listener can read", () => {
    expect(
      resolveAvailability({ availability: { state: "unavailable", reason: "rights_removed" } }).reason,
    ).toBe("Taken down after a rights complaint.");
    expect(
      resolveAvailability({ availability: { state: "unavailable", reason: "under_review" } }).reason,
    ).toBe("On hold while it is being checked.");
  });

  it("never shows a raw code it does not recognise", () => {
    const resolved = resolveAvailability({
      availability: { state: "unavailable", reason: "some_new_code" },
    });

    expect(resolved.reason).toBe(GENERIC_UNAVAILABLE_REASON);
    expect(resolved.reason).not.toContain("_");
  });

  it("falls back to the plain `playable` flag when no reason was sent", () => {
    const resolved = resolveAvailability({ playable: false });
    expect(resolved.playable).toBe(false);
    expect(resolved.reason).toBe(GENERIC_UNAVAILABLE_REASON);
  });

  it("explains a device-only file rather than calling it withdrawn", () => {
    const resolved = resolveAvailability({ available: false });
    expect(resolved.playable).toBe(false);
    expect(resolved.reason?.toLowerCase()).toContain("another device");
  });

  it("gives an entry that no longer resolves a reason instead of a hole", () => {
    const resolved = resolveAvailability(null);
    expect(resolved.playable).toBe(false);
    expect(resolved.label).toBe("Unavailable");
  });

  it("keeps unavailable entries out of the queue while leaving the list intact", () => {
    const entries = [
      { id: "a", playable: true },
      { id: "b", ...WITHDRAWN },
      { id: "c", playable: true },
    ];

    expect(queueableTracks(entries).map((e) => e.id)).toEqual(["a", "c"]);
    // The caller's list is untouched — rendering still shows all three.
    expect(entries).toHaveLength(3);
  });
});

describe("the words on an unavailable row (#1793)", () => {
  it("states the reason as text, not as colour alone", () => {
    const html = renderToStaticMarkup(
      <TrackUnavailableNote availability={resolveAvailability(WITHDRAWN)} />,
    );

    expect(html).toContain("Unavailable");
    expect(html).toContain("The artist withdrew this from streaming");
  });

  it("says nothing at all about a track that plays fine", () => {
    const html = renderToStaticMarkup(
      <TrackUnavailableNote availability={resolveAvailability({ playable: true })} />,
    );

    expect(html).toBe("");
  });
});
