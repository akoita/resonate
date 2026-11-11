import type { LlmTrackPick } from "./agent_runtime.adapter";

/**
 * The tracks a model run was actually shown. Each catalog tool result is
 * recorded here, and the run's reply may only pick from this set: a track id
 * the tools never returned in this run is not a pick, whatever the reply says.
 * The tools apply the session's own rules (explicit choice, played tracks,
 * request scope, public availability) before returning, so a pick bound to
 * their results has passed them.
 */
export class OfferedTracks {
  private readonly ids = new Set<string>();

  /** Records the `items[].id` values of one tool result. */
  record(result: unknown): void {
    const items = (result as { items?: unknown } | null | undefined)?.items;
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const id = (item as { id?: unknown } | null | undefined)?.id;
      if (typeof id === "string" && id.length > 0) this.ids.add(id);
    }
  }

  has(trackId: string): boolean {
    return this.ids.has(trackId);
  }

  get size(): number {
    return this.ids.size;
  }
}

/** Keeps the picks whose track the run's tools returned, in the reply's order. */
export function keepOfferedPicks(
  picks: LlmTrackPick[],
  offered: OfferedTracks,
): { picks: LlmTrackPick[]; dropped: number } {
  const kept = picks.filter((pick) => offered.has(pick.trackId));
  return { picks: kept, dropped: picks.length - kept.length };
}

export const MODEL_REASONING_MAX_LENGTH = 300;

/** Model free text kept for the run record: one line, no control characters, bounded. */
export function boundedReasoning(text: string | undefined): string {
  return (text ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MODEL_REASONING_MAX_LENGTH);
}
