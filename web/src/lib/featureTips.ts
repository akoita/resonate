/**
 * Feature tips: a small, friendly pop-up that points out a feature that is easy to miss
 * (multi-select in a track list, dragging onto a playlist, …) right where it can be used.
 *
 * The rules keep tips from turning into nagging:
 * - each tip appears at most once in this browser, wherever it is placed;
 * - at most one tip is on screen at a time, and a new one waits a cooldown after the last;
 * - a tip waits a short delay after its spot becomes relevant, and only while the tab is visible;
 * - "Turn off tips" (in the tip, or Settings › Help & tips) stops all of them.
 *
 * Everything lives in this browser only (localStorage), like the AI DJ first-session hint
 * (`agentFirstSessionTip.ts`): the server never learns which tips someone saw. Storage can be
 * missing or refuse access, so every access is guarded, and when the state cannot be read no
 * tip is shown: a tip that cannot be remembered would come back on every visit.
 */

export type FeatureTipId =
    | "select-several-tracks"
    | "drag-to-playlist"
    | "queue-from-cards"
    | "loop-passage";

export interface FeatureTipContext {
    /** "Cmd" on Apple platforms, "Ctrl" elsewhere. */
    modKey: "Cmd" | "Ctrl";
    /** A touch screen without a mouse: no right-click, no modifier keys. */
    touch: boolean;
}

export interface FeatureTipDefinition {
    id: FeatureTipId;
    title: string;
    body: (context: FeatureTipContext) => string;
    /** The User Guide passage that explains the feature in full. */
    learnMore: { href: string };
    /** Only offer the tip with a mouse or trackpad (modifier clicks, drag and drop, right-click). */
    needsFinePointer: boolean;
}

export const FEATURE_TIPS: Record<FeatureTipId, FeatureTipDefinition> = {
    "select-several-tracks": {
        id: "select-several-tracks",
        title: "Work on several tracks at once",
        body: ({ modKey }) =>
            `Hold Shift and click to select a run of tracks, or ${modKey}-click to pick them one by one. A bar above the list then acts on all of them at once. A plain click still plays.`,
        learnMore: { href: "/help/playing-music#queue-controls" },
        needsFinePointer: true,
    },
    "drag-to-playlist": {
        id: "drag-to-playlist",
        title: "Drop tracks on a playlist",
        body: () =>
            "Drag a track, or a whole selection, from your library or another playlist onto any playlist here to add it. The original stays where it was.",
        learnMore: { href: "/help/library-playlists#playlists" },
        needsFinePointer: true,
    },
    "queue-from-cards": {
        id: "queue-from-cards",
        title: "Queue without opening",
        body: ({ touch }) =>
            touch
                ? "Tap the queue button on any release, artist, playlist or track card to Play next or Add to queue without leaving this page."
                : "Right-click any release, artist, playlist or track card, or use its queue button, to Play next or Add to queue without leaving this page.",
        learnMore: { href: "/help/playing-music#queue-controls" },
        needsFinePointer: false,
    },
    "loop-passage": {
        id: "loop-passage",
        title: "Loop just one passage",
        body: () =>
            "Open Loop and Repeat to replay a section between two points, A and B, or to repeat a track or the whole queue a set number of times.",
        learnMore: { href: "/help/playing-music#queue-controls" },
        needsFinePointer: false,
    },
};

export const FEATURE_TIPS_STORAGE_KEY = "resonate.featureTips";

/** At most one new tip per day. */
export const FEATURE_TIP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** How long a spot must stay relevant before its tip appears. */
export const FEATURE_TIP_SHOW_DELAY_MS = 2500;

export interface FeatureTipsState {
    /** The listener turned tips off. */
    off: boolean;
    /** Tips already shown in this browser. */
    seen: FeatureTipId[];
    /** When the last tip appeared (ms since epoch). */
    lastShownAt: number | null;
}

export const DEFAULT_FEATURE_TIPS_STATE: FeatureTipsState = { off: false, seen: [], lastShownAt: null };

function isTipId(value: unknown): value is FeatureTipId {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(FEATURE_TIPS, value);
}

/** Read stored state leniently: anything unrecognised falls back to the defaults. */
export function parseFeatureTipsState(raw: string | null): FeatureTipsState {
    if (!raw) return { ...DEFAULT_FEATURE_TIPS_STATE, seen: [] };
    try {
        const value = JSON.parse(raw) as Partial<Record<keyof FeatureTipsState, unknown>>;
        if (!value || typeof value !== "object") return { ...DEFAULT_FEATURE_TIPS_STATE, seen: [] };
        return {
            off: value.off === true,
            seen: Array.isArray(value.seen) ? value.seen.filter(isTipId) : [],
            lastShownAt:
                typeof value.lastShownAt === "number" && Number.isFinite(value.lastShownAt) ? value.lastShownAt : null,
        };
    } catch {
        return { ...DEFAULT_FEATURE_TIPS_STATE, seen: [] };
    }
}

/** Whether this tip may appear now. */
export function canShowFeatureTip(state: FeatureTipsState, id: FeatureTipId, now: number): boolean {
    if (state.off || state.seen.includes(id)) return false;
    return state.lastShownAt === null || now - state.lastShownAt >= FEATURE_TIP_COOLDOWN_MS;
}

/** A tip counts as seen as soon as it appears, so ignoring it never brings it back. */
export function withFeatureTipShown(state: FeatureTipsState, id: FeatureTipId, now: number): FeatureTipsState {
    return {
        ...state,
        seen: state.seen.includes(id) ? state.seen : [...state.seen, id],
        lastShownAt: now,
    };
}

/** The current state, or null when this browser's storage cannot be read. */
export function readFeatureTipsState(): FeatureTipsState | null {
    try {
        return parseFeatureTipsState(globalThis.localStorage.getItem(FEATURE_TIPS_STORAGE_KEY));
    } catch {
        return null;
    }
}

/** Persist the state. Returns false when storage refused the write. */
export function writeFeatureTipsState(state: FeatureTipsState): boolean {
    try {
        globalThis.localStorage.setItem(FEATURE_TIPS_STORAGE_KEY, JSON.stringify(state));
    } catch {
        return false;
    }
    notify();
    return true;
}

/** Marks storage that cannot be read, for `getFeatureTipsSnapshot`. */
export const FEATURE_TIPS_UNAVAILABLE = "unavailable";

/**
 * The raw stored value, as a `useSyncExternalStore` snapshot (a string compares by value):
 * the JSON, null when nothing is stored, or `FEATURE_TIPS_UNAVAILABLE`.
 */
export function getFeatureTipsSnapshot(): string | null {
    try {
        return globalThis.localStorage.getItem(FEATURE_TIPS_STORAGE_KEY);
    } catch {
        return FEATURE_TIPS_UNAVAILABLE;
    }
}

/** Turn every tip off, or back on. */
export function setFeatureTipsOff(off: boolean): boolean {
    const state = readFeatureTipsState() ?? { ...DEFAULT_FEATURE_TIPS_STATE, seen: [] };
    return writeFeatureTipsState({ ...state, off });
}

/** Forget which tips were shown, so each can appear again (one per day, as before). */
export function resetFeatureTips(): boolean {
    return writeFeatureTipsState({ off: false, seen: [], lastShownAt: null });
}

export function featureTipModKey(platform: string | undefined): "Cmd" | "Ctrl" {
    return platform && /mac|iphone|ipad|ipod/i.test(platform) ? "Cmd" : "Ctrl";
}

// ── One tip on screen at a time ────────────────────────────────────────────

/** The tip on screen, and which placement owns it (the same tip can sit in several places). */
export interface ActiveFeatureTip {
    id: FeatureTipId;
    owner: string;
}

let activeTip: ActiveFeatureTip | null = null;
const listeners = new Set<() => void>();

function notify() {
    listeners.forEach((listener) => listener());
}

function setActive(next: ActiveFeatureTip | null) {
    activeTip = next;
    notify();
}

/** Listen for the tip on screen, or the stored state, changing. */
export function subscribeFeatureTips(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getActiveFeatureTip(): ActiveFeatureTip | null {
    return activeTip;
}

/**
 * Try to put this tip on screen for `owner`. It appears only when no other tip is showing, the
 * rules allow it, and the choice can be remembered; it is recorded as seen at once.
 */
export function openFeatureTip(id: FeatureTipId, owner: string, now: number = Date.now()): boolean {
    if (activeTip) return activeTip.id === id && activeTip.owner === owner;
    const state = readFeatureTipsState();
    if (!state || !canShowFeatureTip(state, id, now)) return false;
    if (!writeFeatureTipsState(withFeatureTipShown(state, id, now))) return false;
    setActive({ id, owner });
    return true;
}

/** Close the tip if `owner` is the one showing it. */
export function closeFeatureTip(owner: string): void {
    if (activeTip?.owner === owner) setActive(null);
}

/** "Turn off tips" from a tip: remember it and close whatever is open. */
export function turnOffFeatureTips(): void {
    setFeatureTipsOff(true);
    setActive(null);
}

/** Test helper: forget the tip on screen. */
export function __resetActiveFeatureTipForTests(): void {
    activeTip = null;
    listeners.clear();
}
