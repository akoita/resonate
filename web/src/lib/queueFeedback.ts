import type { QueueBatchResult } from "./playerQueue";

/** Where the tracks were placed: at the end of the queue, or right after the current one. */
export type QueueFeedbackMode = "queue" | "next";

export interface QueueFeedback {
  type: "success" | "info";
  title: string;
  message: string;
}

/**
 * Single source of truth for "you queued something" copy.
 *
 * Every surface that queues tracks (player, library, release, playlists) used
 * to inline its own ternary chain, so the same outcome was announced four
 * different ways — and always in counter-speak ("0 added; 3 duplicates
 * skipped."). Routing them all through here keeps the wording identical and
 * lets each message say the one thing a listener actually wants to know:
 * where the track landed, and how long the queue is now.
 */
export function describeQueueResult(
  result: QueueBatchResult,
  mode: QueueFeedbackMode,
): QueueFeedback {
  const added = result.added.length;
  const skipped = result.skipped.length;
  const queued = result.queue.length;

  if (added === 0 && skipped === 0) {
    return {
      type: "info",
      title: "Nothing to queue",
      message: "There are no playable tracks here.",
    };
  }

  if (added === 0) {
    const only = skipped === 1 ? result.skipped[0] : null;
    return {
      type: "info",
      title: "Already lined up",
      message: only
        ? `${quoted(only.title)} is ${mode === "next" ? "playing or already up next" : "already in your queue"}.`
        : `All ${countOf(skipped)} are already in your queue.`,
    };
  }

  const only = added === 1 ? result.added[0] : null;
  if (only) {
    return {
      type: "success",
      title: mode === "next" ? "Up next" : "Added to queue",
      message: mode === "next"
        ? `${quoted(only.title)} plays after the current track.`
        : `${quoted(only.title)} · ${countOf(queued)} in queue`,
    };
  }

  return {
    type: "success",
    title: mode === "next" ? `${countOf(added)} up next` : `${countOf(added)} queued`,
    message: skipped > 0
      ? `${countOf(queued)} in queue · ${skipped} already there`
      : `${countOf(queued)} in queue`,
  };
}

function countOf(total: number): string {
  return `${total} track${total === 1 ? "" : "s"}`;
}

function quoted(title: string): string {
  return `“${title}”`;
}
