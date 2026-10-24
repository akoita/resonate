import { afterEach, describe, expect, it, vi } from "vitest";
import { listeningRequestFromCrateParse } from "../../../backend/src/modules/agents/agent_session_request";
import { parseCrateRequestText } from "../../../backend/src/modules/crates/crate_request_parser";
import {
    FIRST_SESSION_TIP_EXAMPLE,
    FIRST_SESSION_TIP_STORAGE_KEY,
    dismissFirstSessionTip,
    isFirstSessionTipDismissed,
} from "./agentFirstSessionTip";

function stubStorage(overrides: Partial<Storage> = {}) {
    const values = new Map<string, string>();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
        ...overrides,
    } as unknown as Storage;
    vi.stubGlobal("localStorage", storage);
    return values;
}

describe("first-session tip (#2327)", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("suggests a sentence the parser reads fully, with something to filter on", () => {
        const parsed = listeningRequestFromCrateParse(parseCrateRequestText(FIRST_SESSION_TIP_EXAMPLE));
        expect(parsed.unparsed).toEqual([]);
        expect(parsed.ignored).toEqual([]);
        expect(parsed.request.genres.length).toBeGreaterThan(0);
        expect(parsed.request.moods.length + (parsed.request.energy ? 1 : 0)).toBeGreaterThan(0);
    });

    it("is not dismissed until it is, and then stays dismissed in this browser", () => {
        const values = stubStorage();
        expect(isFirstSessionTipDismissed()).toBe(false);
        dismissFirstSessionTip();
        expect(values.has(FIRST_SESSION_TIP_STORAGE_KEY)).toBe(true);
        expect(isFirstSessionTipDismissed()).toBe(true);
    });

    it("stays hidden when the storage cannot be read, so it never comes back on every visit", () => {
        stubStorage({
            getItem: () => {
                throw new Error("blocked");
            },
        });
        expect(isFirstSessionTipDismissed()).toBe(true);
    });

    it("does not throw when the dismissal cannot be saved", () => {
        stubStorage({
            setItem: () => {
                throw new Error("quota");
            },
        });
        expect(() => dismissFirstSessionTip()).not.toThrow();
    });

    it("does not throw when there is no storage at all", () => {
        vi.stubGlobal("localStorage", undefined);
        expect(isFirstSessionTipDismissed()).toBe(true);
        expect(() => dismissFirstSessionTip()).not.toThrow();
    });
});
