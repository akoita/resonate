import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DJ_SET_STORAGE_KEY,
    addDjSetTracks,
    getDjSet,
    resetDjSetForTests,
    setDjSet,
    subscribeDjSet,
} from "./agentDjSet";

function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
        getItem: vi.fn((key: string) => data.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
        removeItem: vi.fn((key: string) => void data.delete(key)),
        data,
    };
}

const SET = { sessionId: "s-1", preferences: { genres: ["Focus"] }, trackIds: ["t-1", "t-2"] };

describe("agentDjSet", () => {
    beforeEach(() => {
        resetDjSetForTests();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        resetDjSetForTests();
    });

    it("sets, gets and clears the set", () => {
        vi.stubGlobal("sessionStorage", memoryStorage());
        expect(getDjSet()).toBeNull();
        setDjSet(SET);
        expect(getDjSet()).toEqual(SET);
        setDjSet(null);
        expect(getDjSet()).toBeNull();
    });

    it("returns a stable snapshot until the set changes", () => {
        vi.stubGlobal("sessionStorage", memoryStorage());
        setDjSet(SET);
        expect(getDjSet()).toBe(getDjSet());
    });

    it("appends only new track ids", () => {
        vi.stubGlobal("sessionStorage", memoryStorage());
        setDjSet(SET);
        addDjSetTracks(["t-2", "t-3", "t-3", ""]);
        expect(getDjSet()?.trackIds).toEqual(["t-1", "t-2", "t-3"]);
        const before = getDjSet();
        addDjSetTracks(["t-1"]);
        expect(getDjSet()).toBe(before);
    });

    it("ignores added tracks when there is no set", () => {
        vi.stubGlobal("sessionStorage", memoryStorage());
        addDjSetTracks(["t-1"]);
        expect(getDjSet()).toBeNull();
    });

    it("notifies subscribers until they unsubscribe", () => {
        vi.stubGlobal("sessionStorage", memoryStorage());
        const listener = vi.fn();
        const unsubscribe = subscribeDjSet(listener);
        setDjSet(SET);
        addDjSetTracks(["t-3"]);
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
        setDjSet(null);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("mirrors to sessionStorage and restores after a reload", () => {
        const storage = memoryStorage();
        vi.stubGlobal("sessionStorage", storage);
        setDjSet(SET);
        expect(JSON.parse(storage.data.get(DJ_SET_STORAGE_KEY) ?? "null")).toEqual(SET);

        resetDjSetForTests(); // simulate a reload: memory gone, storage kept
        expect(getDjSet()).toEqual(SET);

        setDjSet(null);
        expect(storage.data.has(DJ_SET_STORAGE_KEY)).toBe(false);
    });

    it("ignores corrupt stored data", () => {
        vi.stubGlobal("sessionStorage", memoryStorage({ [DJ_SET_STORAGE_KEY]: "{not json" }));
        expect(getDjSet()).toBeNull();
        resetDjSetForTests();
        vi.stubGlobal("sessionStorage", memoryStorage({ [DJ_SET_STORAGE_KEY]: JSON.stringify({ trackIds: "x" }) }));
        expect(getDjSet()).toBeNull();
    });

    it("keeps working in memory when storage throws", () => {
        const throwing = {
            getItem: () => {
                throw new Error("denied");
            },
            setItem: () => {
                throw new Error("quota");
            },
            removeItem: () => {
                throw new Error("denied");
            },
        };
        vi.stubGlobal("sessionStorage", throwing);
        expect(getDjSet()).toBeNull();
        expect(() => setDjSet(SET)).not.toThrow();
        expect(getDjSet()).toEqual(SET);
        expect(() => addDjSetTracks(["t-3"])).not.toThrow();
        expect(getDjSet()?.trackIds).toContain("t-3");
        expect(() => setDjSet(null)).not.toThrow();
        expect(getDjSet()).toBeNull();
    });

    it("works without any storage", () => {
        vi.stubGlobal("sessionStorage", undefined);
        setDjSet(SET);
        expect(getDjSet()).toEqual(SET);
    });
});
