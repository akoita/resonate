import { describe, expect, it } from "vitest";
import type { DiscoveryJournalItem } from "../../lib/api";
import {
    followUpLabel,
    formatGroupLabel,
    hasJournalItems,
    journalItemToLocalTrack,
    trackCountLabel,
} from "./journal";

const NOW = new Date("2026-06-15T15:00:00.000Z");

const item: DiscoveryJournalItem = {
    trackId: "t1",
    title: "Night Drive",
    artistId: "a1",
    artistName: "Credited Artist",
    releaseId: "r1",
    releaseTitle: "Release One",
    artworkUrl: "https://example.test/art.jpg",
    hasUploadedArtwork: false,
    artworkRevision: 1,
    resonatedAt: "2026-06-14T09:00:00.000Z",
    followUp: "saved",
    discovery: true,
    reason: { code: "discovery_pick", text: "Discovery pick: new verified artist close to your taste" },
    nextAction: { kind: "artist_page", label: "Visit artist page", href: "/artist/a1" },
};

describe("formatGroupLabel", () => {
    it("labels recent UTC days relatively", () => {
        expect(formatGroupLabel({ date: "2026-06-15", sessionId: null }, NOW)).toBe("Today");
        expect(formatGroupLabel({ date: "2026-06-14", sessionId: null }, NOW)).toBe("Yesterday");
        expect(formatGroupLabel({ date: "2026-06-11", sessionId: null }, NOW)).toBe("4 days ago");
    });

    it("uses a full date after a week", () => {
        expect(formatGroupLabel({ date: "2026-05-20", sessionId: null }, NOW)).toBe("May 20, 2026");
    });

    it("marks session groups", () => {
        expect(formatGroupLabel({ date: "2026-06-14", sessionId: "s1" }, NOW)).toBe("Yesterday · AI DJ session");
    });

    it("never throws on a malformed date", () => {
        expect(formatGroupLabel({ date: "nope", sessionId: null }, NOW)).toBe("Earlier");
    });
});

describe("journal helpers", () => {
    it("labels the follow-up and counts tracks", () => {
        expect(followUpLabel("saved")).toBe("Saved");
        expect(followUpLabel("replayed")).toBe("Replayed");
        expect(trackCountLabel(1)).toBe("1 track");
        expect(trackCountLabel(3)).toBe("3 tracks");
    });

    it("detects an empty journal", () => {
        expect(hasJournalItems(null)).toBe(false);
        const base = {
            schemaVersion: "discovery-journal/v1" as const,
            window: { days: 28, from: "", to: "" },
            headline: { resonantDiscoveriesThisWeek: 0, newArtistsThisWeek: 0 },
        };
        expect(hasJournalItems({ ...base, groups: [] })).toBe(false);
        expect(hasJournalItems({ ...base, groups: [{ key: "k", sessionId: null, date: "2026-06-14", items: [item] }] })).toBe(true);
    });

    it("builds a playlist track with no price or license data", () => {
        const track = journalItemToLocalTrack(item);
        expect(track).toMatchObject({
            id: "t1",
            catalogTrackId: "t1",
            title: "Night Drive",
            artist: "Credited Artist",
            album: "Release One",
            releaseId: "r1",
            source: "remote",
            remoteArtworkUrl: "https://example.test/art.jpg",
        });
        expect(Object.keys(track).join(" ")).not.toMatch(/price|license|listing|token|purchase/i);
    });
});
