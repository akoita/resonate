import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HELP_ARTICLES } from "./help/content";
import {
    FEATURE_TIPS,
    FEATURE_TIPS_STORAGE_KEY,
    FEATURE_TIP_COOLDOWN_MS,
    __resetActiveFeatureTipForTests,
    canShowFeatureTip,
    closeFeatureTip,
    featureTipModKey,
    getActiveFeatureTip,
    openFeatureTip,
    parseFeatureTipsState,
    readFeatureTipsState,
    resetFeatureTips,
    setFeatureTipsOff,
    turnOffFeatureTips,
    withFeatureTipShown,
    type FeatureTipId,
} from "./featureTips";
import { placeFeatureTip } from "../components/ui/FeatureTip";

function stubStorage(overrides: Partial<Storage> = {}) {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
        ...overrides,
    } as unknown as Storage);
    return values;
}

const DAY = FEATURE_TIP_COOLDOWN_MS;

describe("feature tips: rules", () => {
    it("shows a tip once, then waits a day before any other tip", () => {
        let state = parseFeatureTipsState(null);
        expect(canShowFeatureTip(state, "select-several-tracks", 1000)).toBe(true);
        state = withFeatureTipShown(state, "select-several-tracks", 1000);
        expect(canShowFeatureTip(state, "select-several-tracks", 1000 + 10 * DAY)).toBe(false);
        expect(canShowFeatureTip(state, "loop-passage", 1000 + DAY - 1)).toBe(false);
        expect(canShowFeatureTip(state, "loop-passage", 1000 + DAY)).toBe(true);
    });

    it("shows nothing once tips are off", () => {
        const state = { ...parseFeatureTipsState(null), off: true };
        expect(canShowFeatureTip(state, "queue-from-cards", Date.now())).toBe(false);
    });

    it("reads damaged or foreign storage as a fresh start, dropping unknown tips", () => {
        expect(parseFeatureTipsState("{not json")).toEqual({ off: false, seen: [], lastShownAt: null });
        expect(parseFeatureTipsState('{"off":"yes","seen":["gone","loop-passage"],"lastShownAt":"x"}')).toEqual({
            off: false,
            seen: ["loop-passage"],
            lastShownAt: null,
        });
    });

    it("says Cmd on Apple devices and Ctrl elsewhere", () => {
        expect(featureTipModKey("MacIntel")).toBe("Cmd");
        expect(featureTipModKey("iPad")).toBe("Cmd");
        expect(featureTipModKey("Win32")).toBe("Ctrl");
        expect(featureTipModKey(undefined)).toBe("Ctrl");
        expect(FEATURE_TIPS["select-several-tracks"].body({ modKey: "Cmd", touch: false })).toContain("Cmd-click");
        expect(FEATURE_TIPS["queue-from-cards"].body({ modKey: "Ctrl", touch: true })).not.toContain("Right-click");
    });

    it("links every tip to a User Guide section that exists", () => {
        for (const tip of Object.values(FEATURE_TIPS)) {
            const [path, section] = tip.learnMore.href.split("#");
            const article = HELP_ARTICLES.find((candidate) => `/help/${candidate.slug}` === path);
            expect(article, tip.id).toBeDefined();
            expect(article?.sections.some((s) => s.id === section), tip.id).toBe(true);
        }
    });
});

describe("feature tips: one on screen at a time", () => {
    beforeEach(() => __resetActiveFeatureTipForTests());
    afterEach(() => {
        __resetActiveFeatureTipForTests();
        vi.unstubAllGlobals();
    });

    it("opens one tip, records it as seen, and keeps a second one waiting", () => {
        const values = stubStorage();
        expect(openFeatureTip("select-several-tracks", "queue", 5000)).toBe(true);
        expect(getActiveFeatureTip()).toEqual({ id: "select-several-tracks", owner: "queue" });
        expect(JSON.parse(values.get(FEATURE_TIPS_STORAGE_KEY)!)).toMatchObject({
            seen: ["select-several-tracks"],
            lastShownAt: 5000,
        });
        // Another placement of the same tip, or another tip, stays hidden.
        expect(openFeatureTip("select-several-tracks", "playlist", 5000)).toBe(false);
        expect(openFeatureTip("loop-passage", "bar", 5000)).toBe(false);
        closeFeatureTip("playlist");
        expect(getActiveFeatureTip()?.owner).toBe("queue");
        closeFeatureTip("queue");
        expect(getActiveFeatureTip()).toBeNull();
        // Closed tips do not come back, and the next one waits the cooldown.
        expect(openFeatureTip("select-several-tracks", "queue", 5000 + 2 * DAY)).toBe(false);
        expect(openFeatureTip("loop-passage", "bar", 5000 + 1)).toBe(false);
        expect(openFeatureTip("loop-passage", "bar", 5000 + DAY)).toBe(true);
    });

    it("turning tips off closes the open one and keeps the rest away until turned back on", () => {
        stubStorage();
        openFeatureTip("queue-from-cards", "catalog", 0);
        turnOffFeatureTips();
        expect(getActiveFeatureTip()).toBeNull();
        expect(readFeatureTipsState()?.off).toBe(true);
        expect(openFeatureTip("loop-passage", "bar", 10 * DAY)).toBe(false);
        setFeatureTipsOff(false);
        expect(openFeatureTip("loop-passage", "bar", 10 * DAY)).toBe(true);
    });

    it("Show tips again lets every tip appear again", () => {
        stubStorage();
        const ids: FeatureTipId[] = ["select-several-tracks", "drag-to-playlist"];
        ids.forEach((id, index) => {
            openFeatureTip(id, id, index * DAY);
            closeFeatureTip(id);
        });
        expect(resetFeatureTips()).toBe(true);
        expect(readFeatureTipsState()).toEqual({ off: false, seen: [], lastShownAt: null });
        expect(openFeatureTip("select-several-tracks", "queue", 0)).toBe(true);
    });

    it("shows nothing when this browser cannot remember it", () => {
        stubStorage({
            getItem: () => {
                throw new Error("blocked");
            },
        });
        expect(readFeatureTipsState()).toBeNull();
        expect(openFeatureTip("loop-passage", "bar", 0)).toBe(false);

        stubStorage({
            setItem: () => {
                throw new Error("quota");
            },
        });
        expect(openFeatureTip("loop-passage", "bar", 0)).toBe(false);
        expect(getActiveFeatureTip()).toBeNull();
    });
});

describe("feature tips: placement", () => {
    const viewport = { width: 1280, height: 800 };

    it("sits above its anchor with the arrow over the anchor's start", () => {
        const spot = placeFeatureTip({ top: 400, bottom: 700, left: 900, width: 360 }, "above", 150, viewport);
        expect(spot).toMatchObject({ side: "above", top: 400 - 10 - 150, left: 900, width: 320 });
        expect(spot?.arrowLeft).toBe(32);
    });

    it("flips below when there is no room above, and stays inside the viewport", () => {
        const spot = placeFeatureTip({ top: 60, bottom: 100, left: 1200, width: 60 }, "above", 150, viewport);
        expect(spot?.side).toBe("below");
        expect(spot!.left + spot!.width).toBeLessThanOrEqual(viewport.width - 16);
    });

    it("overlaps the top of an anchor too tall to sit beside, and waits while it is off screen", () => {
        expect(placeFeatureTip({ top: 100, bottom: 790, left: 20, width: 300 }, "above", 150, viewport)?.side).toBe("inside");
        expect(placeFeatureTip({ top: 900, bottom: 1200, left: 20, width: 300 }, "above", 150, viewport)).toBeNull();
    });

    it("fits a phone screen with a 16px gutter", () => {
        const spot = placeFeatureTip({ top: 500, bottom: 600, left: 0, width: 320 }, "above", 150, { width: 320, height: 640 });
        expect(spot).toMatchObject({ left: 16, width: 288 });
    });
});
