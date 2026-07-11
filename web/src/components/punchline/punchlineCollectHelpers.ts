/**
 * Pure helpers for the fan-facing Collect Moments module (#486).
 *
 * Framework-free and exported for direct unit testing (repo convention). The
 * collect-state selector is the single source of truth for what the Collect
 * CTA shows, so every state (owned / sold out / paid-pending / sign-in /
 * collectable) is decided in one tested place.
 */

import { API_BASE, type PunchlineDrop, type PunchlineMoment } from "../../lib/api";

/**
 * Resolve a stored clip asset uri into something the browser can play.
 * GCS/IPFS assets are absolute URLs already; local-storage assets are
 * API-relative paths shaped `/catalog/stems/<file>/blob`.
 */
export function resolveClipUrl(clipAssetUri: string | null): string | null {
  if (!clipAssetUri) {
    return null;
  }
  const trimmed = clipAssetUri.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `${API_BASE}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

export type MomentCollectState =
  | "collectable" // free, editions remain, signed in, not owned yet
  | "sign_in" // free, editions remain, not signed in
  | "owned" // the viewer already owns an edition
  | "sold_out" // no editions remain
  | "paid_pending"; // priced moment — the paid rail is #1462

/**
 * Decide the CTA state for one moment. Owned wins over sold-out (owning an
 * edition of a sold-out moment should read as success, not scarcity), and
 * sold-out wins over payment (an unbuyable moment is out regardless of price).
 */
export function momentCollectState(input: {
  moment: Pick<PunchlineMoment, "editionSize" | "priceCents" | "collectedCount">;
  ownedMomentIds: ReadonlySet<string>;
  momentId: string;
  signedIn: boolean;
}): MomentCollectState {
  if (input.ownedMomentIds.has(input.momentId)) {
    return "owned";
  }
  if (input.moment.collectedCount >= input.moment.editionSize) {
    return "sold_out";
  }
  if (input.moment.priceCents > 0) {
    return "paid_pending";
  }
  return input.signedIn ? "collectable" : "sign_in";
}

/** "97 of 100 left" / "Sold out" — the scarcity line under each card. */
export function formatEditionsRemaining(
  editionSize: number,
  collectedCount: number,
): string {
  const remaining = Math.max(0, editionSize - collectedCount);
  if (remaining === 0) {
    return "Sold out";
  }
  return `${remaining.toLocaleString()} of ${editionSize.toLocaleString()} left`;
}

/** Drops that actually have moments, for rendering. */
export function collectableDrops(drops: PunchlineDrop[]): PunchlineDrop[] {
  return drops.filter(
    (drop) => drop.status === "published" && drop.moments.length > 0,
  );
}

/**
 * Set progress for one drop: how many of its moments the viewer owns.
 * Returns null when signed out (no progress to show).
 */
export function dropSetProgress(
  drop: Pick<PunchlineDrop, "moments">,
  ownedMomentIds: ReadonlySet<string>,
  signedIn: boolean,
): { owned: number; total: number; complete: boolean } | null {
  if (!signedIn) {
    return null;
  }
  const total = drop.moments.length;
  const owned = drop.moments.filter((m) => ownedMomentIds.has(m.id)).length;
  return { owned, total, complete: total > 0 && owned >= total };
}

/** Map a collect API error payload onto a readable message + a state nudge. */
export function describeCollectError(error: unknown): {
  message: string;
  becameState: MomentCollectState | null;
} {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("sold_out")) {
    return {
      message: "Just sold out — all editions are gone.",
      becameState: "sold_out",
    };
  }
  if (text.includes("already_collected")) {
    return {
      message: "You already own an edition of this moment.",
      becameState: "owned",
    };
  }
  if (text.includes("payment_rail_pending")) {
    return {
      message: "Paid collecting isn't open yet — this one will be collectable soon.",
      becameState: "paid_pending",
    };
  }
  return {
    message: "Could not collect this moment. Please try again.",
    becameState: null,
  };
}
