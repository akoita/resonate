import { useSyncExternalStore } from "react";
import type { AgentNextPreferences } from "./api";

/**
 * The AI DJ set currently loaded in the player.
 *
 * The DJ panel records the set when it starts playing the DJ's picks; the
 * global continuation component reads it to fetch more picks as the queue runs
 * out, from any page. Kept in memory and mirrored to sessionStorage so a page
 * reload keeps the set going (the player restores its own queue the same way).
 */
export type DjSet = {
    sessionId: string;
    preferences: AgentNextPreferences;
    trackIds: string[];
    /** What the Now & Up next card says about each pick (#2243); absent for picks the client has no note on. */
    picks?: Record<string, DjPickNote>;
};

/**
 * One pick's plain explanation. `reason` is a sentence from the shared
 * explanation vocabulary (server-authored), never model free text.
 */
export type DjPickNote = {
    reason?: string;
    /** "ai" only when the AI curator chose it; a rule-based or fallback pick is "rules" (#2075). */
    source?: "ai" | "rules";
    /**
     * #2312: false when the pick does not match the session's filters (the DJ
     * added it to fill the set); true when it does. Absent when the session has
     * no filters or the client has no flag.
     */
    matched?: boolean;
};

const MAX_REASON_LENGTH = 120;

function cleanNotes(value: unknown, trackIds: readonly string[]): Record<string, DjPickNote> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const allowed = new Set(trackIds);
    const notes: Record<string, DjPickNote> = {};
    for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
        if (!allowed.has(id) || !raw || typeof raw !== "object") continue;
        const { reason, source, matched } = raw as Partial<DjPickNote>;
        const note: DjPickNote = {};
        if (typeof reason === "string" && reason.trim()) note.reason = reason.trim().slice(0, MAX_REASON_LENGTH);
        if (source === "ai" || source === "rules") note.source = source;
        if (typeof matched === "boolean") note.matched = matched;
        if (note.reason || note.source || note.matched !== undefined) notes[id] = note;
    }
    return Object.keys(notes).length > 0 ? notes : undefined;
}

export const DJ_SET_STORAGE_KEY = "resonate.aiDjSet";

type Listener = () => void;

const listeners = new Set<Listener>();
let current: DjSet | null = null;
let hydrated = false;

function readStored(): DjSet | null {
    try {
        const raw = globalThis.sessionStorage?.getItem(DJ_SET_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<DjSet> | null;
        if (
            !parsed ||
            typeof parsed.sessionId !== "string" ||
            !parsed.sessionId ||
            !Array.isArray(parsed.trackIds)
        ) {
            return null;
        }
        return {
            sessionId: parsed.sessionId,
            preferences: parsed.preferences && typeof parsed.preferences === "object" ? parsed.preferences : {},
            trackIds: parsed.trackIds.filter((id): id is string => typeof id === "string"),
            ...notesField(cleanNotes(parsed.picks, parsed.trackIds.filter((id): id is string => typeof id === "string"))),
        };
    } catch {
        return null;
    }
}

function notesField(picks: Record<string, DjPickNote> | undefined): { picks?: Record<string, DjPickNote> } {
    return picks ? { picks } : {};
}

function writeStored(set: DjSet | null): void {
    try {
        if (!globalThis.sessionStorage) return;
        if (set) {
            globalThis.sessionStorage.setItem(DJ_SET_STORAGE_KEY, JSON.stringify(set));
        } else {
            globalThis.sessionStorage.removeItem(DJ_SET_STORAGE_KEY);
        }
    } catch {
        // Storage can be unavailable or full; the in-memory set still works.
    }
}

function hydrate(): void {
    if (hydrated) return;
    hydrated = true;
    current = readStored();
}

function commit(next: DjSet | null): void {
    hydrated = true;
    current = next;
    writeStored(next);
    listeners.forEach((listener) => listener());
}

/** The DJ set in the player, or null when none is live. Snapshot is referentially stable between changes. */
export function getDjSet(): DjSet | null {
    hydrate();
    return current;
}

/** Replace (or clear, with null) the DJ set. */
export function setDjSet(set: DjSet | null): void {
    if (!set) {
        commit(null);
        return;
    }
    const trackIds = Array.from(new Set(set.trackIds));
    commit({
        sessionId: set.sessionId,
        preferences: withoutSentence(set.preferences),
        trackIds,
        ...notesField(cleanNotes(set.picks, trackIds)),
    });
}

/**
 * The set is mirrored to sessionStorage, so the typed sentence (#2241) is left out of it. The
 * server keeps the sentence in memory for the live session, so a continuation that omits it
 * still searches by it; an edit in the prompt sends it again.
 */
function withoutSentence(preferences: AgentNextPreferences): AgentNextPreferences {
    const rest = { ...preferences };
    delete rest.requestText;
    return rest;
}

/** Record more track ids (and what to say about them) on the current set. No-op when there is no set or nothing new. */
export function addDjSetTracks(ids: string[], notes?: Record<string, DjPickNote>): void {
    const set = getDjSet();
    if (!set) return;
    const known = new Set(set.trackIds);
    const added = ids.filter((id) => id && !known.has(id));
    if (added.length === 0) return;
    const trackIds = [...set.trackIds, ...Array.from(new Set(added))];
    commit({
        ...set,
        trackIds,
        ...notesField(cleanNotes({ ...(set.picks ?? {}), ...(notes ?? {}) }, trackIds)),
    });
}

/**
 * Take tracks out of the set (the listener said "Not this", or the swap on a
 * seed) and optionally add replacements with their notes, in one update.
 */
export function replaceDjSetTracks(remove: readonly string[], add: readonly string[], notes?: Record<string, DjPickNote>): void {
    const set = getDjSet();
    if (!set) return;
    const gone = new Set(remove);
    const kept = set.trackIds.filter((id) => !gone.has(id));
    const keptSet = new Set(kept);
    const fresh = Array.from(new Set(add.filter((id) => id && !keptSet.has(id))));
    const trackIds = [...kept, ...fresh];
    commit({
        ...set,
        trackIds,
        ...notesField(cleanNotes({ ...(set.picks ?? {}), ...(notes ?? {}) }, trackIds)),
    });
}

export function subscribeDjSet(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** React binding for the current DJ set. */
export function useDjSet(): DjSet | null {
    return useSyncExternalStore(subscribeDjSet, getDjSet, () => null);
}

/** Test helper: forget in-memory state so the next read re-hydrates from storage. */
export function resetDjSetForTests(): void {
    current = null;
    hydrated = false;
    listeners.clear();
}
