import type { LocalTrack } from "./localLibrary";

export interface QueueBatchResult {
  queue: LocalTrack[];
  added: LocalTrack[];
  skipped: LocalTrack[];
}

/** Add unique tracks in input order, keeping the existing queue unchanged. */
export function appendQueueTracks(
  queue: readonly LocalTrack[],
  tracks: readonly LocalTrack[],
): QueueBatchResult {
  return addQueueTracksAt(queue, tracks, queue.length);
}

/**
 * Add unique tracks immediately after the current item. `currentIndex` is
 * clamped so an empty queue or stale persisted index remains safe.
 */
export function insertQueueTracksNext(
  queue: readonly LocalTrack[],
  currentIndex: number,
  tracks: readonly LocalTrack[],
): QueueBatchResult {
  const insertionIndex = Math.min(
    queue.length,
    Math.max(0, Math.trunc(currentIndex) + 1),
  );
  const incoming = uniqueTracks(tracks);
  const currentTrackId = queue[Math.max(0, insertionIndex - 1)]?.id;
  const requestedIds = new Set(incoming.map((track) => track.id));
  if (currentTrackId) requestedIds.delete(currentTrackId);

  const requested = incoming
    .filter((track) => track.id !== currentTrackId)
    .map((track) => queue.find((queued) => queued.id === track.id) ?? track);
  const withoutRequested = queue.filter((track) => !requestedIds.has(track.id));
  const adjustedInsertionIndex = Math.min(insertionIndex, withoutRequested.length);
  const nextQueue = [
    ...withoutRequested.slice(0, adjustedInsertionIndex),
    ...requested,
    ...withoutRequested.slice(adjustedInsertionIndex),
  ];
  const unchanged = nextQueue.length === queue.length
    && nextQueue.every((track, index) => track.id === queue[index]?.id);

  return {
    queue: nextQueue,
    added: unchanged ? [] : requested,
    skipped: [
      ...incoming.filter((track) => track.id === currentTrackId),
      ...(unchanged ? requested : []),
    ],
  };
}

function addQueueTracksAt(
  queue: readonly LocalTrack[],
  tracks: readonly LocalTrack[],
  insertionIndex: number,
): QueueBatchResult {
  const seenIds = new Set(queue.map((track) => track.id));
  const added: LocalTrack[] = [];
  const skipped: LocalTrack[] = [];

  for (const track of tracks) {
    if (seenIds.has(track.id)) {
      skipped.push(track);
      continue;
    }
    seenIds.add(track.id);
    added.push(track);
  }

  return {
    queue: [
      ...queue.slice(0, insertionIndex),
      ...added,
      ...queue.slice(insertionIndex),
    ],
    added,
    skipped,
  };
}

export interface ShuffleCycleState {
  /** Playback route, including entries from earlier completed cycles. */
  history: string[];
  /** Currently selected entry in history, or -1 before playback starts. */
  position: number;
  /** Unique IDs already played in the active shuffle cycle. */
  played: string[];
}

export interface ShuffleNavigationResult {
  trackId: string | null;
  state: ShuffleCycleState;
}

export type ShuffleRandom = () => number;

export function createShuffleCycleState(
  currentTrackId: string | null = null,
): ShuffleCycleState {
  return currentTrackId
    ? { history: [currentTrackId], position: 0, played: [currentTrackId] }
    : { history: [], position: -1, played: [] };
}

/**
 * Reconcile persisted shuffle state against the live queue. Removed tracks are
 * discarded; the current track is always recorded as played.
 */
export function reconcileShuffleCycle(
  state: ShuffleCycleState,
  eligibleTrackIds: readonly string[],
  currentTrackId: string | null,
): ShuffleCycleState {
  const eligible = uniqueIds(eligibleTrackIds);
  const eligibleSet = new Set(eligible);
  const history = state.history.filter((id) => eligibleSet.has(id));
  const played = uniqueIds(state.played.filter((id) => eligibleSet.has(id)));
  let position = history.length === 0
    ? -1
    : Math.min(Math.max(Math.trunc(state.position), 0), history.length - 1);

  if (currentTrackId && eligibleSet.has(currentTrackId)) {
    const currentPosition = findClosestHistoryPosition(
      history,
      currentTrackId,
      position,
    );
    if (currentPosition >= 0) {
      position = currentPosition;
    } else {
      history.splice(position + 1);
      history.push(currentTrackId);
      position = history.length - 1;
    }
    if (!played.includes(currentTrackId)) played.push(currentTrackId);
  }

  return { history, position, played };
}

export function shuffleNext(
  state: ShuffleCycleState,
  eligibleTrackIds: readonly string[],
  currentTrackId: string | null,
  options: { repeatAll?: boolean; random?: ShuffleRandom } = {},
): ShuffleNavigationResult {
  const eligible = uniqueIds(eligibleTrackIds);
  const reconciled = reconcileShuffleCycle(state, eligible, currentTrackId);

  // Moving back does not erase the known future route. Next retraces it first.
  if (reconciled.position + 1 < reconciled.history.length) {
    const position = reconciled.position + 1;
    return {
      trackId: reconciled.history[position],
      state: { ...reconciled, position },
    };
  }

  let played = reconciled.played;
  let candidates = eligible.filter((id) => !played.includes(id));
  if (candidates.length === 0 && options.repeatAll && eligible.length > 0) {
    // The item finishing the old cycle is the first played item in the new
    // cycle, preventing an immediate repeat whenever another item exists.
    played = currentTrackId && eligible.includes(currentTrackId)
      ? [currentTrackId]
      : [];
    candidates = eligible.filter((id) => !played.includes(id));
    if (candidates.length === 0 && eligible.length === 1) {
      candidates = eligible;
    }
  }

  if (candidates.length === 0) {
    return { trackId: null, state: { ...reconciled, played } };
  }

  const trackId = candidates[randomIndex(options.random ?? Math.random, candidates.length)];
  const history = reconciled.history.slice(0, reconciled.position + 1);
  history.push(trackId);
  return {
    trackId,
    state: {
      history,
      position: history.length - 1,
      played: uniqueIds([...played, trackId]),
    },
  };
}

export function shufflePrevious(
  state: ShuffleCycleState,
  eligibleTrackIds: readonly string[],
  currentTrackId: string | null,
): ShuffleNavigationResult {
  const reconciled = reconcileShuffleCycle(
    state,
    eligibleTrackIds,
    currentTrackId,
  );
  if (reconciled.position <= 0) {
    return { trackId: null, state: reconciled };
  }
  const position = reconciled.position - 1;
  return {
    trackId: reconciled.history[position],
    state: { ...reconciled, position },
  };
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function uniqueTracks(tracks: readonly LocalTrack[]): LocalTrack[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

function findClosestHistoryPosition(
  history: readonly string[],
  trackId: string,
  position: number,
): number {
  if (history[position] === trackId) return position;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index] === trackId) return index;
  }
  return -1;
}

function randomIndex(random: ShuffleRandom, length: number): number {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.min(length - 1, Math.max(0, Math.floor(value * length)));
}
