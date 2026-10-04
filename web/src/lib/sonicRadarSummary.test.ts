import { describe, expect, it } from "vitest";
import type { DiscoveryJournal, DiscoveryJournalItem, DiscoveryJournalPendingItem } from "./api";
import {
    followUpDaysLeft,
    pendingItemToLocalTrack,
    pendingItems,
    resonantItemCount,
    saveDeadlineLabel,
    sonicRadarBanner,
} from "./sonicRadarSummary";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;

function pending(id: string, overrides: Partial<DiscoveryJournalPendingItem> = {}): DiscoveryJournalPendingItem {
    return {
        trackId: id,
        title: `Title ${id}`,
        artistId: "a1",
        artistName: "Artist One",
        releaseId: `r-${id}`,
        releaseTitle: "Release One",
        artworkUrl: "https://example.test/art.jpg",
        hasUploadedArtwork: false,
        artworkRevision: 1,
        completedAt: "2026-10-03T12:00:00.000Z",
        followUpBy: "2026-10-10T12:00:00.000Z",
        discovery: false,
        ...overrides,
    };
}

function resonant(id: string): DiscoveryJournalItem {
    return {
        ...pending(id),
        resonatedAt: "2026-10-03T12:00:00.000Z",
        followUp: "saved",
        reason: { code: "listening_pattern", text: "Fit" },
        nextAction: null,
    };
}

function journal(resonantIds: string[][], pendingIds: string[] | undefined, newArtists = 0): DiscoveryJournal {
    return {
        schemaVersion: "discovery-journal/v1",
        window: { days: 28, from: "2026-09-06T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z" },
        headline: { resonantDiscoveriesThisWeek: 0, newArtistsThisWeek: newArtists },
        groups: resonantIds.map((ids, i) => ({
            key: `day:${i}`,
            sessionId: null,
            date: "2026-10-03",
            items: ids.map(resonant),
        })),
        ...(pendingIds ? { pending: pendingIds.map((id) => pending(id)) } : {}),
    };
}

describe("resonantItemCount / pendingItems", () => {
    it("sums items across groups", () => {
        expect(resonantItemCount(journal([["a", "b"], ["c"]], []))).toBe(3);
    });

    it("handles a missing journal", () => {
        expect(resonantItemCount(null)).toBe(0);
        expect(pendingItems(null)).toEqual([]);
    });

    it("treats a missing pending field (older backend) as empty", () => {
        expect(pendingItems(journal([], undefined))).toEqual([]);
    });
});

describe("sonicRadarBanner", () => {
    it("reports resonant tracks with the journal's own window and new artists", () => {
        expect(sonicRadarBanner(journal([["a", "b"], ["c"]], ["p1"], 2))).toEqual({
            kind: "resonant",
            count: 3,
            newArtistsThisWeek: 2,
            windowDays: 28,
        });
    });

    it("falls back to the pending count when nothing has resonated", () => {
        expect(sonicRadarBanner(journal([], ["p1", "p2"]))).toEqual({ kind: "pending", count: 2 });
    });

    it("is empty with no resonant and no pending tracks", () => {
        expect(sonicRadarBanner(journal([], []))).toEqual({ kind: "empty" });
        expect(sonicRadarBanner(journal([], undefined))).toEqual({ kind: "empty" });
        expect(sonicRadarBanner(null)).toEqual({ kind: "empty" });
    });

    it("ignores groups that hold no items", () => {
        expect(sonicRadarBanner(journal([[]], ["p1"]))).toEqual({ kind: "pending", count: 1 });
    });
});

describe("followUpDaysLeft / saveDeadlineLabel", () => {
    const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

    it("counts whole days, rounding partial days up", () => {
        expect(followUpDaysLeft(at(3 * DAY), NOW)).toBe(3);
        expect(followUpDaysLeft(at(2 * DAY + 1), NOW)).toBe(3);
        expect(followUpDaysLeft(at(7 * DAY), NOW)).toBe(7);
    });

    it("never goes below zero", () => {
        expect(followUpDaysLeft(at(-DAY), NOW)).toBe(0);
        expect(followUpDaysLeft(at(0), NOW)).toBe(0);
    });

    it("returns 0 for an unparseable date", () => {
        expect(followUpDaysLeft("not a date", NOW)).toBe(0);
    });

    it("labels the deadline", () => {
        expect(saveDeadlineLabel(at(3 * DAY), NOW)).toBe("Save within 3 days");
        expect(saveDeadlineLabel(at(DAY - 1), NOW)).toBe("Last day to save");
        expect(saveDeadlineLabel(at(DAY), NOW)).toBe("Last day to save");
        expect(saveDeadlineLabel(at(-DAY), NOW)).toBe("Last day to save");
    });
});

describe("pendingItemToLocalTrack", () => {
    it("builds the catalog track the library expects", () => {
        const track = pendingItemToLocalTrack(pending("t1"));
        expect(track).toMatchObject({
            id: "t1",
            title: "Title t1",
            artist: "Artist One",
            album: "Release One",
            source: "remote",
            catalogTrackId: "t1",
            artistId: "a1",
            releaseId: "r-t1",
            remoteArtworkUrl: "https://example.test/art.jpg",
        });
    });

    it("omits artwork when there is none", () => {
        expect(pendingItemToLocalTrack(pending("t2", { artworkUrl: null })).remoteArtworkUrl).toBeUndefined();
    });
});
