import type { LocalTrack } from "./localLibrary";
import { catalogTrackIdOf } from "./trackIdentity";

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

/** Nudges the repeat-count field by one, holding it inside the count createFiniteRepeat accepts. */
export function stepRepeatCount(value: string, delta: 1 | -1): string {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed) || parsed < 1) return "1";
  const next = (Number.isInteger(parsed) ? parsed : delta > 0 ? Math.floor(parsed) : Math.ceil(parsed)) + delta;
  return String(Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, next)));
}

/** Called only at a natural track end or a complete queue cycle. */
export function consumeRepeat(plan: FiniteRepeat): { replay: boolean; plan: FiniteRepeat | null } {
  return plan.remaining > 0
    ? { replay: true, plan: { ...plan, remaining: plan.remaining - 1 } }
    : { replay: false, plan: null };
}

/** Additional repeats scheduled for tracks that are not playing yet, keyed by queue track id. */
export type ScheduledRepeats = Readonly<Record<string, number>>;

/** Schedule (count ≥ 1) or cancel (count 0) the additional repeats a track gets when it next plays. */
export function scheduleTrackRepeat(schedule: ScheduledRepeats, trackId: string, count: number): ScheduledRepeats | null {
  if (!trackId || !Number.isSafeInteger(count) || count < 0) return null;
  const next = { ...schedule };
  if (count === 0) delete next[trackId];
  else next[trackId] = count;
  return next;
}

/** The scheduled count for a track, matched by queue id or catalog id. */
export function scheduledRepeatFor(schedule: ScheduledRepeats, track: Pick<LocalTrack, "id" | "catalogTrackId">) {
  const key = scheduledRepeatKey(schedule, track);
  return key ? schedule[key] : 0;
}

/** Hand a track's scheduled repeats to the player as it starts; the schedule entry is used once. */
export function takeScheduledRepeat(schedule: ScheduledRepeats, track: Pick<LocalTrack, "id" | "catalogTrackId">): { plan: FiniteRepeat | null; schedule: ScheduledRepeats } {
  const key = scheduledRepeatKey(schedule, track);
  if (!key) return { plan: null, schedule };
  const next = { ...schedule };
  delete next[key];
  return { plan: createFiniteRepeat("track", schedule[key]), schedule: next };
}

function scheduledRepeatKey(schedule: ScheduledRepeats, track: Pick<LocalTrack, "id" | "catalogTrackId">) {
  if (schedule[track.id]) return track.id;
  if (track.catalogTrackId && schedule[track.catalogTrackId]) return track.catalogTrackId;
  return null;
}

export function queueSnapshot(queue: readonly LocalTrack[]) {
  const seen = new Set<string>();
  const trackIds: string[] = [];
  const invalid: LocalTrack[] = [];
  for (const track of queue) {
    const id = catalogTrackIdOf(track);
    if (!id) { invalid.push(track); continue; }
    if (!seen.has(id)) { trackIds.push(id); seen.add(id); }
  }
  return { trackIds, invalid };
}
