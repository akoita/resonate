"use client";

import type { TrackAvailability } from "../../lib/api";

/**
 * #1793 — what a listener sees when a track they saved cannot be streamed.
 *
 * The rule this file exists to hold: an entry that cannot be played still
 * belongs in the list. Dropping it makes a playlist silently shrink and leaves
 * the listener with no idea what happened. So every surface renders the whole
 * list and asks this module what to say about each row, and asks it again —
 * separately — which rows may go into the queue.
 *
 * Two things it will never do:
 *  - let an artist's withdrawal reach a purchase. A buyer keeps what they
 *    bought. The one thing that does outrank a purchase is a legal removal —
 *    see `resolveAvailability`.
 *  - rely on colour. Every unplayable row carries words.
 */

/** What a row needs to carry for us to judge it. All fields optional. */
export type AvailabilityBearing = {
  /** Playlist read models carry this today; false means "not streamable here". */
  playable?: boolean;
  /** The richer reason, when the read model has one. */
  availability?: TrackAvailability | null;
  /** A purchased item. Playable through a withdrawal, but not through a takedown. */
  isOwned?: boolean;
  /** Device-local files: false when the file lives on another device. */
  available?: boolean;
};

export type ResolvedAvailability = {
  /** May this row be played, and may it go into a queue? */
  playable: boolean;
  /** Short words shown beside the title. Null when there is nothing to say. */
  label: string | null;
  /** One plain sentence explaining why. Null when there is nothing to say. */
  reason: string | null;
};

const AVAILABLE: ResolvedAvailability = { playable: true, label: null, reason: null };

const UNAVAILABLE_LABEL = "Unavailable";

/** The sentence a listener reads when an artist has paused a release. */
export const WITHDRAWN_REASON = "The artist withdrew this from streaming. It may come back.";

/** The sentence for everything else we cannot play. */
export const GENERIC_UNAVAILABLE_REASON = "No longer available.";

/** A device-local file that is not on this device. */
export const OTHER_DEVICE_REASON = "This file is on another device.";

/**
 * The server answers `unavailable` with a machine code, not a sentence. A
 * listener must never be shown one of those raw, so every code we know about
 * gets words here and anything we do not recognise falls back to the plain
 * sentence rather than leaking `rights_removed` into the UI.
 */
const UNAVAILABLE_REASON_TEXT: Record<string, string> = {
  removed: GENERIC_UNAVAILABLE_REASON,
  rights_removed: "Taken down after a rights complaint.",
  under_review: "On hold while it is being checked.",
  restricted: "Not available to stream here.",
  not_published: "Not published right now.",
  local_file: OTHER_DEVICE_REASON,
};

function unavailableReasonText(reason: string | null | undefined) {
  const value = reason?.trim();
  if (!value) return GENERIC_UNAVAILABLE_REASON;
  const known = UNAVAILABLE_REASON_TEXT[value];
  if (known) return known;
  // A code-shaped value we do not know yet is not sentence material.
  if (/^[a-z0-9_]+$/.test(value)) return GENERIC_UNAVAILABLE_REASON;
  return value;
}

/**
 * Decide how one row should be treated. `null`/`undefined` means the entry a
 * playlist still points at could not be resolved at all — that is exactly the
 * hole this issue is about, so it gets a row and a reason too.
 */
export function resolveAvailability(entry: AvailabilityBearing | null | undefined): ResolvedAvailability {
  if (!entry) {
    return { playable: false, label: UNAVAILABLE_LABEL, reason: GENERIC_UNAVAILABLE_REASON };
  }

  const state = entry.availability;

  // A purchase is not on loan, and an artist withdrawing a release does not
  // reach one: the buyer keeps what they paid for.
  //
  // But ownership does NOT override a rights removal or a review hold. Those
  // are not the artist's choice and not ours — a takedown obliges us to stop
  // serving the material, and "they bought it" is not an answer to that. The
  // copy they already downloaded is beyond our reach; what we still serve is
  // not. Ordering this check after the legal states is the whole difference,
  // and flipping it back would quietly turn a takedown into a suggestion.
  const legallyBlocked =
    state?.state === "unavailable" &&
    (state.reason === "rights_removed" || state.reason === "under_review");
  if (entry.isOwned && !legallyBlocked) return AVAILABLE;

  if (state && state.state === "withdrawn") {
    return {
      playable: false,
      label: UNAVAILABLE_LABEL,
      reason: state.reason?.trim()
        ? `${WITHDRAWN_REASON} The artist said: “${state.reason.trim()}”`
        : WITHDRAWN_REASON,
    };
  }
  if (state && state.state === "unavailable") {
    return {
      playable: false,
      label: UNAVAILABLE_LABEL,
      reason: unavailableReasonText(state.reason),
    };
  }
  if (state && state.state === "available") return AVAILABLE;

  if (entry.playable === false) {
    return { playable: false, label: UNAVAILABLE_LABEL, reason: GENERIC_UNAVAILABLE_REASON };
  }
  if (entry.available === false) {
    return { playable: false, label: UNAVAILABLE_LABEL, reason: OTHER_DEVICE_REASON };
  }
  return AVAILABLE;
}

/** Shorthand for the many places that only need the yes/no. */
export function isPlayableEntry(entry: AvailabilityBearing | null | undefined): boolean {
  return resolveAvailability(entry).playable;
}

/**
 * The tracks that may go into a queue. Callers keep the full list for
 * rendering — this is only ever used for playback.
 */
export function queueableTracks<T extends AvailabilityBearing>(entries: readonly T[]): T[] {
  return entries.filter((entry) => isPlayableEntry(entry));
}

/**
 * The words on an unplayable row. Rendered as text, never as colour alone, so
 * it survives a screen reader and a high-contrast theme.
 */
export function TrackUnavailableNote({ availability }: { availability: ResolvedAvailability }) {
  if (availability.playable || !availability.label) return null;
  return (
    <span className="track-unavailable-note">
      <span className="pl-public-unplayable-tag">{availability.label}</span>
      {availability.reason ? (
        <span
          className="track-unavailable-reason"
          style={{ marginLeft: "0.4rem", fontSize: "0.78em", opacity: 0.75 }}
        >
          {availability.reason}
        </span>
      ) : null}
    </span>
  );
}
