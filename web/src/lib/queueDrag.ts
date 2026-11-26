/**
 * Dragging tracks into the player queue from anywhere in the app.
 *
 * The library, release pages, catalog cards and the playlists panel already
 * drag JSON payloads (see `components/layout/playlistDrop.ts`). The queue
 * accepts the same payloads, plus an in-memory offer a drag source can make
 * when it already holds the tracks, or knows how to fetch them (a catalog
 * card), so nothing large has to be serialized into the drag data.
 *
 * Only drags that start in this document are accepted. Drag data from another
 * page or app is untrusted text: a crafted "track" could otherwise point the
 * player at any URL.
 */
import type { LocalTrack } from "./localLibrary";

/** Marks a drag the queue can take. Types are readable during `dragover`; values are not. */
export const QUEUE_DRAG_TYPE = "application/x-resonate-queue";
/** Marks a drag that started on a queue row, so the queue does not offer to take it back. */
export const QUEUE_ROW_DRAG_TYPE = "application/x-resonate-queue-row";

export interface QueueDragOffer {
  /** Shown while hovering a drop target, e.g. a release title. */
  title?: string;
  resolve: () => Promise<LocalTrack[]> | LocalTrack[];
}

let offer: QueueDragOffer | null = null;
let dragStartedHere = false;
/** Position of the queue row being dragged, for reordering. */
let draggedRowIndex: number | null = null;
const listeners = new Set<(active: boolean) => void>();

function notify(active: boolean) {
  listeners.forEach((listener) => listener(active));
}

/** Attach tracks (or a resolver) to a drag that is starting. */
export function offerQueueDrag(dataTransfer: DataTransfer | null, next: QueueDragOffer): void {
  offer = next;
  try {
    dataTransfer?.setData(QUEUE_DRAG_TYPE, next.title ?? "tracks");
  } catch {
    // Some engines refuse extra types on a link drag; the in-memory offer stands.
  }
}

export function currentQueueDragOffer(): QueueDragOffer | null {
  return offer;
}

/**
 * True when a drag over a target could be queued: it started in this
 * document and is not a queue row being dragged back onto the queue.
 */
export function canQueueDrag(types: readonly string[] | DOMStringList | null | undefined): boolean {
  if (!dragStartedHere || !types) return false;
  const list = Array.from(types as ArrayLike<string>);
  if (list.includes(QUEUE_ROW_DRAG_TYPE)) return false;
  return list.includes(QUEUE_DRAG_TYPE) || list.includes("application/json");
}

/** Whether a queueable drag from this document is in progress. */
export function isQueueDragActive(): boolean {
  return dragStartedHere;
}

/**
 * Follows drags for the whole document. Call once per mounted drop target;
 * the returned function unsubscribes.
 */
export function subscribeQueueDrag(listener: (active: boolean) => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("dragstart", onDragStart, true);
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("dragend", onDragEnd, true);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("dragstart", onDragStart, true);
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("dragend", onDragEnd, true);
    }
  };
}

let decided = false;

function onDragStart() {
  // Capture phase: runs before the source's own handler, which may then make
  // an offer. Sources may stop the event there, so nothing is decided here.
  offer = null;
  draggedRowIndex = null;
  dragStartedHere = true;
  decided = false;
}

function onDragOver(event: DragEvent) {
  // The first `dragover` after a start is where the source's drag types are
  // known (they stay readable during a drag). A drag the queue cannot take,
  // such as a link, a text selection or a queue row, never shows the targets.
  if (!dragStartedHere || decided) return;
  decided = true;
  notify(canQueueDrag(event.dataTransfer?.types));
}

function onDragEnd() {
  // `drop` on the target has already run by now.
  dragStartedHere = false;
  decided = false;
  offer = null;
  draggedRowIndex = null;
  notify(false);
}

/** Test seam: forget any drag state. */
export function resetQueueDragForTests(): void {
  offer = null;
  draggedRowIndex = null;
  dragStartedHere = false;
  decided = false;
}

/** Test seam: pretend a drag started in this document. */
export function markQueueDragStartedForTests(): void {
  dragStartedHere = true;
}

type TrackLookup = (id: string) => Promise<LocalTrack | null>;
type LibraryLister = () => Promise<LocalTrack[]>;

function isTrackLike(value: unknown): value is LocalTrack {
  if (!value || typeof value !== "object") return false;
  const track = value as Record<string, unknown>;
  return typeof track.id === "string" && Boolean(track.id) && typeof track.title === "string";
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * The tracks a dropped JSON payload stands for, in order. Library ids are
 * looked up (the library copy is authoritative); tracks a release page
 * dragged in full are used as dragged when the lookup finds nothing.
 */
export async function resolveDroppedTracks(
  raw: string | null | undefined,
  lookup: TrackLookup,
  listLibrary: LibraryLister,
): Promise<LocalTrack[]> {
  if (!raw) return [];
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    data = parsed as Record<string, unknown>;
  } catch {
    return [];
  }

  const byId = async (id: unknown, dragged?: unknown): Promise<LocalTrack | null> => {
    if (typeof id !== "string" || !id) return null;
    const found = await lookup(id).catch(() => null);
    if (found) return found;
    return isTrackLike(dragged) ? dragged : null;
  };

  const many = async (items: unknown): Promise<LocalTrack[]> => {
    if (!Array.isArray(items)) return [];
    const tracks = await Promise.all(
      items.map((item) => byId((item as Record<string, unknown> | null)?.id, item)),
    );
    return tracks.filter((track): track is LocalTrack => Boolean(track));
  };

  switch (data.type) {
    case "track": {
      const track = await byId(data.id);
      return track ? [track] : [];
    }
    case "reorder-track": {
      const track = await byId(data.trackId);
      return track ? [track] : [];
    }
    case "release-track": {
      const dragged = data.track as Record<string, unknown> | undefined;
      const track = await byId(dragged?.id, dragged);
      return track ? [track] : [];
    }
    case "album":
    case "release-selection":
    case "release-album": {
      const tracks = await many(data.tracks);
      if (tracks.length > 0 || data.type !== "album") return tracks;
      // Legacy library album cards carry only a name.
      const album = text(data.name);
      if (!album) return [];
      const artist = text(data.artist);
      return (await listLibrary()).filter((track) => track.album === album && (!artist || track.artist === artist));
    }
    case "artist": {
      const artist = text(data.name);
      if (!artist) return [];
      return (await listLibrary()).filter((track) => track.artist === artist);
    }
    default:
      return [];
  }
}

/** The drag payload a queue row carries, so it can be dropped on a playlist. */
export function queueRowDragPayload(track: LocalTrack): string {
  return JSON.stringify({
    type: "track",
    id: track.id,
    catalogTrackId: track.catalogTrackId ?? null,
    title: track.title,
    artist: track.artist,
  });
}

/**
 * Start dragging a queue row: a copy onto a playlist, or, when `index` is
 * given, a move to another spot in the same queue. It is never offered to the
 * drop lanes, which would only add it twice.
 */
export function startQueueRowDrag(dataTransfer: DataTransfer, track: LocalTrack, index?: number): void {
  const payload = queueRowDragPayload(track);
  dataTransfer.setData("application/json", payload);
  dataTransfer.setData("text/plain", payload);
  dataTransfer.setData(QUEUE_ROW_DRAG_TYPE, track.id);
  dataTransfer.effectAllowed = index === undefined ? "copy" : "copyMove";
  draggedRowIndex = index ?? null;
}

/** The queue position being dragged for a reorder, if a queue row drag is in progress. */
export function draggedQueueRowIndex(types: readonly string[] | DOMStringList | null | undefined): number | null {
  if (!dragStartedHere || draggedRowIndex === null || !types) return null;
  return Array.from(types as ArrayLike<string>).includes(QUEUE_ROW_DRAG_TYPE) ? draggedRowIndex : null;
}

/**
 * Which gap a pointer over a row points at: the gap before the row in its
 * top half, after it in its bottom half.
 */
export function queueGapForPointer(rowIndex: number, pointerY: number, rowTop: number, rowHeight: number): number {
  return pointerY - rowTop < rowHeight / 2 ? rowIndex : rowIndex + 1;
}
