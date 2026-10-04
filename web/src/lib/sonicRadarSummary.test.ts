import { describe, expect, it } from "vitest";
import type {
    DiscoveryJournal,
    DiscoveryJournalItem,
    DiscoveryJournalNewReleaseItem,
    DiscoveryJournalPendingItem,
} from "./api";
import { getReleaseTrackStreamUrl } from "./api";
import {
    addedAgoLabel,
    catalogItemToPlayableTrack,
    newFromDiscoveredItems,
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

function newRelease(id: string, overrides: Partial<DiscoveryJournalNewReleaseItem> = {}): DiscoveryJournalNewReleaseItem {
    return {
        trackId: id,
        title: `New ${id}`,
        artistId: "a1",
        artistName: "Artist One",
        releaseId: `r-${id}`,
        releaseTitle: "Release One",
        artworkUrl: "https://example.test/art.jpg",
        hasUploadedArtwork: false,
        artworkRevision: 1,
        addedAt: "2026-10-03T12:00:00.000Z",
        reason: { code: "new_from_discovered_artist", text: "New from an artist you discovered" },
        ...overrides,
    };
}

function journal(
    resonantIds: string[][],
    pendingIds: string[] | undefined,
    newArtists = 0,
    newIds?: string[],
): DiscoveryJournal {
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
        ...(newIds ? { newFromDiscovered: newIds.map((id) => newRelease(id)) } : {}),
    };
}

describe("resonantItemCount / pendingItems", () => {
    it("sums items across groups", () => {
        expect(resonantItemCount(journal([["a", "b"], ["c"]], []))).toBe(3);
    });

    it("handles a missing journal", () => {
        expect(resonantItemCount(null)).toBe(0);
        expect(pendingItems(null)).toEqual([]);
        expect(newFromDiscoveredItems(null)).toEqual([]);
    });

    it("treats a missing pending field (older backend) as empty", () => {
        expect(pendingItems(journal([], undefined))).toEqual([]);
    });

    it("treats a missing newFromDiscovered field (older backend) as empty", () => {
        expect(newFromDiscoveredItems(journal([["a"]], []))).toEqual([]);
    });

    it("returns the new releases when present", () => {
        expect(newFromDiscoveredItems(journal([["a"]], [], 0, ["n1", "n2"])).map((item) => item.trackId)).toEqual(["n1", "n2"]);
    });
});

describe("sonicRadarBanner", () => {
    it("reports resonant tracks with the journal's own window and new artists", () => {
        expect(sonicRadarBanner(journal([["a", "b"], ["c"]], ["p1"], 2))).toEqual({
            kind: "resonant",
            count: 3,
            newArtistsThisWeek: 2,
            windowDays: 28,
            newTracks: 0,
        });
    });

    it("counts new tracks from artists the listener discovered", () => {
        expect(sonicRadarBanner(journal([["a"]], [], 0, ["n1", "n2", "n3"]))).toMatchObject({
            kind: "resonant",
            newTracks: 3,
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

describe("catalogItemToPlayableTrack", () => {
    it("adds the catalog stream URL so it plays without being saved", () => {
        const track = catalogItemToPlayableTrack(newRelease("n1"));
        expect(track).toMatchObject({
            id: "n1",
            catalogTrackId: "n1",
            releaseId: "r-n1",
            artistId: "a1",
            source: "remote",
            remoteUrl: getReleaseTrackStreamUrl("r-n1", "n1"),
            remoteArtworkUrl: "https://example.test/art.jpg",
        });
        expect(track.remoteUrl).toContain("/catalog/releases/r-n1/tracks/n1/stream");
    });
});

describe("addedAgoLabel", () => {
    const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

    it("labels same-day, yesterday and older additions by UTC calendar day", () => {
        expect(addedAgoLabel(at(-3_600_000), NOW)).toBe("Added today");
        expect(addedAgoLabel("2026-10-03T23:59:00.000Z", NOW)).toBe("Added yesterday");
        expect(addedAgoLabel("2026-10-01T01:00:00.000Z", NOW)).toBe("Added 3 days ago");
        expect(addedAgoLabel(at(-14 * DAY), NOW)).toBe("Added 14 days ago");
    });

    it("never reports a future date as negative", () => {
        expect(addedAgoLabel(at(2 * DAY), NOW)).toBe("Added today");
    });

    it("falls back for an unparseable date", () => {
        expect(addedAgoLabel("not a date", NOW)).toBe("Recently added");
    });
});
