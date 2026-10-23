import { describe, expect, it } from "vitest";
import type { LocalTrack } from "./localLibrary";
import type { DjSet } from "./agentDjSet";
import {
    AI_PICK_LABEL,
    RULES_PICK_LABEL,
    UNNOTED_PICK_LABEL,
    buildUpNext,
    pickNotesFromLicenses,
    pickNotesFromResponse,
    reasonSentence,
} from "./agentUpNext";

const track = (id: string, extra: Partial<LocalTrack> = {}): LocalTrack => ({
    id,
    title: `Title ${id}`,
    artist: `Artist ${id}`,
    albumArtist: null,
    album: null,
    year: null,
    genre: null,
    duration: null,
    createdAt: "2026-01-01T00:00:00Z",
    catalogTrackId: id,
    remoteArtworkUrl: `/art/${id}.jpg`,
    ...extra,
});

describe("reasonSentence", () => {
    it("takes the first helpful sentence of the shared vocabulary", () => {
        expect(reasonSentence(["Catalog candidate", " Sounds close to your taste ", "Other"])).toBe("Sounds close to your taste");
        expect(reasonSentence(["Catalog candidate"])).toBeUndefined();
        expect(reasonSentence(undefined)).toBeUndefined();
    });
});

describe("pickNotesFromResponse", () => {
    it("keys reasons by track id and never reads the free-text pick reason", () => {
        const notes = pickNotesFromResponse({
            status: "ok",
            track: { id: "a", title: "A", artistId: "x" },
            explanation: ["Fits this session intent"],
            curatedBy: "llm",
            tracks: [{ trackId: "b", licenseType: "personal", priceUsd: 0, reason: "MODEL FREE TEXT", explanation: ["Nearby vibe match"] }],
        });
        expect(notes).toEqual({
            a: { reason: "Fits this session intent", source: "ai" },
            b: { reason: "Nearby vibe match", source: "ai" },
        });
        expect(JSON.stringify(notes)).not.toContain("MODEL FREE TEXT");
    });

    it("carries the request-match flag of each pick only when the server sent a boolean (#2312)", () => {
        const notes = pickNotesFromResponse({
            status: "ok",
            track: { id: "a", title: "A", artistId: "x" },
            tracks: [
                { trackId: "a", licenseType: "personal", priceUsd: 0, requestMatch: true },
                { trackId: "b", licenseType: "personal", priceUsd: 0, requestMatch: false },
                { trackId: "c", licenseType: "personal", priceUsd: 0 },
            ],
        });
        expect(notes.a.matched).toBe(true);
        expect(notes.b.matched).toBe(false);
        expect(notes.c).not.toHaveProperty("matched");
    });

    it("never marks a rule-based pick or a fallback as AI", () => {
        const rules = pickNotesFromResponse({ status: "ok", track: { id: "a", title: "A", artistId: "x" }, curatedBy: "rules" });
        const fallback = pickNotesFromResponse({
            status: "ok",
            track: { id: "a", title: "A", artistId: "x" },
            curatedBy: "llm",
            runtimeFallback: { from: "adk", reason: "timeout" },
        });
        expect(rules.a.source).toBe("rules");
        expect(fallback.a.source).toBe("rules");
    });
});

describe("buildUpNext", () => {
    const queue = [track("played"), track("now"), track("own"), track("n1"), track("n2"), track("n3"), track("n4")];
    const set: DjSet = {
        sessionId: "s",
        preferences: {},
        trackIds: ["played", "now", "n1", "n2", "n3", "n4"],
        picks: {
            now: { reason: "Fits this session intent", source: "ai" },
            n1: { source: "rules", reason: "Selected vibe match" },
            n2: { source: "rules" },
        },
    };

    it("is empty without a DJ set", () => {
        expect(buildUpNext(queue, 1, null)).toEqual({ now: null, upNext: [] });
    });

    it("lists the playing DJ track and the next three DJ picks, skipping the listener's own queue entries", () => {
        const view = buildUpNext(queue, 1, set);
        expect(view.now).toMatchObject({ id: "now", title: "Title now", artist: "Artist now", artworkUrl: "/art/now.jpg", reason: "Fits this session intent", queueIndex: 1 });
        expect(view.upNext.map((item) => item.id)).toEqual(["n1", "n2", "n3"]);
        expect(view.upNext[0]).toMatchObject({ reason: "Selected vibe match", sourceLabel: RULES_PICK_LABEL, queueIndex: 3 });
        expect(view.upNext[1]).toMatchObject({ reason: null, sourceLabel: RULES_PICK_LABEL });
        expect(view.upNext[2]).toMatchObject({ reason: null, sourceLabel: UNNOTED_PICK_LABEL });
        expect(view.now?.sourceLabel).toBe(AI_PICK_LABEL);
    });

    it("has no now item when the player is on a track the DJ did not pick", () => {
        const view = buildUpNext(queue, 2, set);
        expect(view.now).toBeNull();
        expect(view.upNext.map((item) => item.id)).toEqual(["n1", "n2", "n3"]);
    });

    it("falls back to the credited artist, then a plain label", () => {
        const credited = [track("a", { artist: null, creditedArtistName: "Credited" }), track("b", { artist: null })];
        const view = buildUpNext(credited, 0, { sessionId: "s", preferences: {}, trackIds: ["a", "b"] });
        expect(view.now?.artist).toBe("Credited");
        expect(view.upNext[0].artist).toBe("Unknown artist");
    });
});

describe("pickNotesFromLicenses", () => {
    it("reads the server-kept explanation and curator of a session's first picks", () => {
        const notes = pickNotesFromLicenses([
            { trackId: "a", recommendation: { recommendation: { explanation: ["Catalog candidate", "Nearby vibe match"] }, curatedBy: "llm" } },
            { trackId: "b", recommendation: { curatedBy: "rules" } },
            { trackId: "c", recommendation: { reason: "FREE TEXT", reasoning: "MODEL TEXT" } },
            { trackId: "d", recommendation: null },
        ]);
        expect(notes).toEqual({
            a: { reason: "Nearby vibe match", source: "ai" },
            b: { source: "rules" },
        });
        expect(JSON.stringify(notes)).not.toContain("TEXT");
    });

    it("carries the request-match flag of a first pick, only when it is a boolean (#2312)", () => {
        const notes = pickNotesFromLicenses([
            { trackId: "a", recommendation: { curatedBy: "llm", requestMatch: false } },
            { trackId: "b", recommendation: { curatedBy: "rules", requestMatch: true } },
            { trackId: "c", recommendation: { requestMatch: false } },
            { trackId: "d", recommendation: { curatedBy: "rules", requestMatch: "no" as unknown as boolean } },
        ]);
        expect(notes).toEqual({
            a: { source: "ai", matched: false },
            b: { source: "rules", matched: true },
            c: { matched: false },
            d: { source: "rules" },
        });
    });
});
