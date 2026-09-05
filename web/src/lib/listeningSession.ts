import type { LocalTrack } from "./localLibrary";

export type QueueSource = { playlistId: string; trackIds: string[]; publicPlaylist?: boolean } | null;
export type SegmentLoop = { start: number; end: number };
export type FiniteRepeat = { target: "track" | "queue"; configured: number; remaining: number };
export type QueuePlayOptions = { playlistId?: string; publicPlaylist?: boolean; sourceTrackIds?: string[]; navigation?: boolean };

export function queueSourceKind(queue: readonly LocalTrack[], source: QueueSource) {
  if (!source) return "ad_hoc" as const;
  return queue.length === source.trackIds.length && queue.every((t, i) => t.id === source.trackIds[i])
    ? "unchanged_playlist" as const : "modified_playlist" as const;
}

export function validateSegment(start: number, end: number, duration: number): SegmentLoop | null {
  if (![start, end, duration].every(Number.isFinite) || duration <= 0) return null;
  const a = Math.max(0, Math.min(start, duration));
  const b = Math.max(0, Math.min(end, duration));
  return Math.round(a * 1000) < Math.round(b * 1000) ? { start: a, end: b } : null;
}

export function createFiniteRepeat(target: FiniteRepeat["target"], count: number): FiniteRepeat | null {
  return (target === "track" || target === "queue") && Number.isSafeInteger(count) && count > 0
    ? { target, configured: count, remaining: count } : null;
}

/** Called only at a natural track end or a complete queue cycle. */
export function consumeRepeat(plan: FiniteRepeat): { replay: boolean; plan: FiniteRepeat | null } {
  return plan.remaining > 0
    ? { replay: true, plan: { ...plan, remaining: plan.remaining - 1 } }
    : { replay: false, plan: null };
}

export function queueSnapshot(queue: readonly LocalTrack[]) {
  const seen = new Set<string>();
  const trackIds: string[] = [];
  const invalid: LocalTrack[] = [];
  for (const track of queue) {
    const id = track.catalogTrackId || (track.source !== "local" && !track.blobKey && track.remoteUrl ? track.id : null);
    if (!id) { invalid.push(track); continue; }
    if (!seen.has(id)) { trackIds.push(id); seen.add(id); }
  }
  return { trackIds, invalid };
}
