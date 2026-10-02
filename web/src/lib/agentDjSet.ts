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
};

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
        };
    } catch {
        return null;
    }
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
    commit(
        set
            ? { sessionId: set.sessionId, preferences: set.preferences, trackIds: Array.from(new Set(set.trackIds)) }
            : null,
    );
}

/** Record more track ids on the current set. No-op when there is no set or nothing new. */
export function addDjSetTracks(ids: string[]): void {
    const set = getDjSet();
    if (!set) return;
    const known = new Set(set.trackIds);
    const added = ids.filter((id) => id && !known.has(id));
    if (added.length === 0) return;
    commit({ ...set, trackIds: [...set.trackIds, ...Array.from(new Set(added))] });
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
