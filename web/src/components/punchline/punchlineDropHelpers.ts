/**
 * Pure helpers for the Punchline Drop builder (#484).
 *
 * These are deliberately framework-free and exported for direct unit testing
 * (the repo convention for this kind of component). Every limit here mirrors the
 * backend service validation in `punchline-drop.service.ts` so a moment the
 * builder accepts is always publishable.
 */

import type { PunchlineDrop, PunchlineMomentInput } from "../../lib/api";

// Mirror of the backend limits (punchline-drop.service.ts).
export const MOMENT_TITLE_MAX = 120;
export const MOMENT_LYRIC_MAX = 500;
export const ARTWORK_URL_MAX = 2048;
export const EDITION_MIN = 1;
export const EDITION_MAX = 10_000;
export const PRICE_CENTS_MAX = 1_000_000;

const ARTWORK_URL_PATTERN = /^(https?:\/\/|ipfs:\/\/)/i;

// ---------------------------------------------------------------------------
// Price: dollars <-> integer cents
// ---------------------------------------------------------------------------

export type PriceParseResult =
  | { ok: true; cents: number }
  | { ok: false; error: string };

/**
 * Parse an artist-entered dollar amount ("1.50", "0", "12") into integer cents.
 * Blank, non-numeric, negative, over-precise, or too-large inputs are rejected
 * with a human message. `0` is allowed and means "free to claim".
 */
export function parsePriceDollarsToCents(input: string): PriceParseResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, error: "Enter a price — use 0 to make it free." };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return {
      ok: false,
      error: "Enter a dollar amount like 1.50 (or 0 for free).",
    };
  }
  const cents = Math.round(Number.parseFloat(trimmed) * 100);
  if (!Number.isFinite(cents) || cents < 0) {
    return { ok: false, error: "Price can’t be negative." };
  }
  if (cents > PRICE_CENTS_MAX) {
    return {
      ok: false,
      error: `Price is too high (maximum $${(PRICE_CENTS_MAX / 100).toLocaleString()}).`,
    };
  }
  return { ok: true, cents };
}

/** Card/summary label for a price in cents. 0 → "Free to claim". */
export function formatPriceCents(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) {
    return "Free to claim";
  }
  return `$${(cents / 100).toFixed(2)}`;
}

/** The dollars string for an edit form, from stored cents. */
export function centsToPriceDollars(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) {
    return "0";
  }
  return (cents / 100).toFixed(2);
}

/** "Limited edition of 100" — the only edition model in the MVP. */
export function formatEditionLabel(size: number): string {
  return `Limited edition of ${size.toLocaleString()}`;
}

// ---------------------------------------------------------------------------
// Moment input validation
// ---------------------------------------------------------------------------

export interface MomentInputFields {
  title: string;
  lyricText: string;
  artworkUrl: string;
  editionSize: string;
  priceDollars: string;
  startMs: number | null;
  endMs: number | null;
}

export interface MomentInputBounds {
  minMs: number;
  maxMs: number;
}

export type MomentFieldKey =
  | "title"
  | "lyricText"
  | "artworkUrl"
  | "editionSize"
  | "price"
  | "range";

export type MomentValidationResult =
  | { ok: true; value: PunchlineMomentInput }
  | { ok: false; errors: Partial<Record<MomentFieldKey, string>> };

function boundSeconds(ms: number): string {
  const s = ms / 1000;
  return Number.isInteger(s) ? `${s}s` : `${s.toFixed(1)}s`;
}

/**
 * Validate the whole moment form against the same limits the backend enforces.
 * Returns either a ready-to-send `PunchlineMomentInput` or a per-field error map
 * so the editor can render inline messages next to the offending control.
 */
export function validateMomentInput(
  fields: MomentInputFields,
  bounds: MomentInputBounds,
): MomentValidationResult {
  const errors: Partial<Record<MomentFieldKey, string>> = {};

  const title = fields.title.trim();
  if (!title) {
    errors.title = "Give this moment a title.";
  } else if (title.length > MOMENT_TITLE_MAX) {
    errors.title = `Title must be ${MOMENT_TITLE_MAX} characters or fewer.`;
  }

  const lyricText = fields.lyricText.trim();
  if (!lyricText) {
    errors.lyricText = "Add the lyric for this moment.";
  } else if (lyricText.length > MOMENT_LYRIC_MAX) {
    errors.lyricText = `Lyric must be ${MOMENT_LYRIC_MAX} characters or fewer — a punchline, not the whole song.`;
  }

  let artworkUrl: string | null = null;
  const art = fields.artworkUrl.trim();
  if (art.length > 0) {
    if (!ARTWORK_URL_PATTERN.test(art)) {
      errors.artworkUrl = "Artwork must be an http(s) or ipfs link.";
    } else if (art.length > ARTWORK_URL_MAX) {
      errors.artworkUrl = "Artwork link is too long.";
    } else {
      artworkUrl = art;
    }
  }

  let editionSize = Number.NaN;
  const editionRaw = fields.editionSize.trim();
  if (!/^\d+$/.test(editionRaw)) {
    errors.editionSize = "Enter a whole number of editions.";
  } else {
    editionSize = Number.parseInt(editionRaw, 10);
    if (editionSize < EDITION_MIN || editionSize > EDITION_MAX) {
      errors.editionSize = `Editions must be between ${EDITION_MIN} and ${EDITION_MAX.toLocaleString()}.`;
    }
  }

  let priceCents = 0;
  const price = parsePriceDollarsToCents(fields.priceDollars);
  if (!price.ok) {
    errors.price = price.error;
  } else {
    priceCents = price.cents;
  }

  const { startMs, endMs } = fields;
  if (startMs == null || endMs == null) {
    errors.range = "Select a clip range on the vocals.";
  } else if (endMs <= startMs) {
    errors.range = "Clip end must come after the start.";
  } else {
    const length = endMs - startMs;
    if (length < bounds.minMs) {
      errors.range = `Clip is too short — clips must be at least ${boundSeconds(bounds.minMs)}.`;
    } else if (length > bounds.maxMs) {
      errors.range = `Clip is too long — clips must be at most ${boundSeconds(bounds.maxMs)}.`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      title,
      lyricText,
      artworkUrl,
      startMs: startMs as number,
      endMs: endMs as number,
      editionSize,
      priceCents,
    },
  };
}

// ---------------------------------------------------------------------------
// Builder view selection (state machine)
// ---------------------------------------------------------------------------

export type PunchlineView =
  | "select-track"
  | "loading"
  | "error"
  | "ineligible"
  | "overview"
  | "builder";

/**
 * Decide which view the panel shows for the current track. An active draft
 * always wins (the artist is mid-build); otherwise eligibility drives the gate.
 */
export function selectPunchlineView(input: {
  selectedTrackId: string | null;
  activeDraft: PunchlineDrop | null;
  loading: boolean;
  error: boolean;
  eligible: boolean | null;
}): PunchlineView {
  if (input.activeDraft) {
    return "builder";
  }
  if (!input.selectedTrackId) {
    return "select-track";
  }
  if (input.loading || input.eligible == null) {
    return "loading";
  }
  if (input.error) {
    return "error";
  }
  if (!input.eligible) {
    return "ineligible";
  }
  return "overview";
}

/** The newest draft among a track's drops (resume target), or null. */
export function newestDraft(drops: PunchlineDrop[]): PunchlineDrop | null {
  return drops.find((d) => d.status === "draft") ?? null;
}

/** Published drops only, for the overview summaries. */
export function publishedDrops(drops: PunchlineDrop[]): PunchlineDrop[] {
  return drops.filter((d) => d.status === "published");
}

/** Total editions across a drop's moments (shown in the publish review). */
export function totalEditions(drop: Pick<PunchlineDrop, "moments">): number {
  return drop.moments.reduce((sum, m) => sum + m.editionSize, 0);
}
