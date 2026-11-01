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
    latestResonantItem,
    pendingItemToLocalTrack,
    pendingItems,
    resonantItemCount,
    saveDeadlineLabel,
    sonicRadarSessionLine,
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

describe("sonicRadarSessionLine", () => {
    const withFollowUps = (items: Array<[string, "saved" | "replayed"]>, pendingIds: string[] = []): DiscoveryJournal => ({
        ...journal([[]], pendingIds),
        groups: [
            {
                key: "day:0",
                sessionId: null,
                date: "2026-10-03",
                items: items.map(([id, followUp]) => ({ ...resonant(id), followUp })),
            },
        ],
    });

    it("splits this session's saved and replayed tracks", () => {
        const data = withFollowUps([["a", "saved"], ["b", "saved"], ["c", "replayed"], ["d", "saved"]]);
        expect(sonicRadarSessionLine(data, ["a", "b", "c"])).toEqual({ kind: "session", saved: 2, replayed: 1 });
    });

    it("ignores resonant tracks that are not in the live set", () => {
        const data = withFollowUps([["a", "saved"], ["x", "saved"], ["y", "replayed"]]);
        expect(sonicRadarSessionLine(data, ["a"])).toEqual({ kind: "session", saved: 1, replayed: 0 });
    });

    it("counts a track once even if the journal lists it in several groups", () => {
        const data = journal([["a"], ["a", "b"]], []);
        expect(sonicRadarSessionLine(data, ["a", "b"])).toEqual({ kind: "session", saved: 2, replayed: 0 });
    });

    it("prefers saved when the same track appears as saved and replayed", () => {
        const data: DiscoveryJournal = {
            ...withFollowUps([["a", "saved"]]),
        };
        data.groups.push({ key: "day:1", sessionId: null, date: "2026-10-02", items: [{ ...resonant("a"), followUp: "replayed" }] });
        expect(sonicRadarSessionLine(data, ["a"])).toEqual({ kind: "session", saved: 1, replayed: 0 });
    });

    it("scopes the one-save-away nudge to this session's tracks", () => {
        const data = journal([["x"]], ["p1", "p2", "p3"]);
        expect(sonicRadarSessionLine(data, ["p1", "p3", "other"])).toEqual({ kind: "pending", count: 2 });
    });

    it("shows resonant session tracks instead of the pending nudge", () => {
        const data = withFollowUps([["a", "replayed"]], ["p1"]);
        expect(sonicRadarSessionLine(data, ["a", "p1"])).toEqual({ kind: "session", saved: 0, replayed: 1 });
    });

    it("falls back to the pending nudge when only other tracks resonated", () => {
        const data = withFollowUps([["x", "saved"]], ["p1"]);
        expect(sonicRadarSessionLine(data, ["p1"])).toEqual({ kind: "pending", count: 1 });
    });

    it("is none without a live set, a journal, or anything from the session", () => {
        const data = journal([["a"]], ["p1"]);
        expect(sonicRadarSessionLine(data, null)).toEqual({ kind: "none" });
        expect(sonicRadarSessionLine(data, undefined)).toEqual({ kind: "none" });
        expect(sonicRadarSessionLine(data, [])).toEqual({ kind: "none" });
        expect(sonicRadarSessionLine(null, ["a"])).toEqual({ kind: "none" });
        expect(sonicRadarSessionLine(undefined, ["a"])).toEqual({ kind: "none" });
        expect(sonicRadarSessionLine(data, ["unrelated"])).toEqual({ kind: "none" });
        expect(sonicRadarSessionLine(journal([], undefined), ["a"])).toEqual({ kind: "none" });
    });

    it("does not read new releases as session discoveries", () => {
        expect(sonicRadarSessionLine(journal([], [], 0, ["n1"]), ["n1"])).toEqual({ kind: "none" });
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

    it("carries the stream URL, because this shape is saved to the library", () => {
        // A save without it overwrote the owner's library row and the track
        // stopped playing from their playlists.
        expect(pendingItemToLocalTrack(pending("t3")).remoteUrl).toBe(getReleaseTrackStreamUrl("r-t3", "t3"));
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

describe("latestResonantItem (#2249 More like...)", () => {
    it("is the track that resonated last, across every day group", () => {
        const older = { ...resonant("older"), resonatedAt: "2026-10-01T09:00:00.000Z" };
        const newest = { ...resonant("newest"), title: "  Harbor Lights ", resonatedAt: "2026-10-03T18:00:00.000Z" };
        const sameDay = { ...resonant("same-day"), resonatedAt: "2026-10-03T08:00:00.000Z" };
        const base = journal([[], []], undefined);
        base.groups[0].items = [older, sameDay];
        base.groups[1].items = [newest];
        expect(latestResonantItem(base)).toEqual({ trackId: "newest", title: "Harbor Lights" });
    });

    it("is null without a resonant track, so the starter is hidden", () => {
        expect(latestResonantItem(null)).toBeNull();
        expect(latestResonantItem(undefined)).toBeNull();
        expect(latestResonantItem(journal([], ["p1"]))).toBeNull();
        // A played-through track that was not replayed or saved has not resonated yet.
        expect(latestResonantItem(journal([[]], ["p1"]))).toBeNull();
    });

    it("skips an item it cannot name or date", () => {
        const base = journal([["a"]], undefined);
        base.groups[0].items = [
            { ...resonant("untitled"), title: "  " },
            { ...resonant("undated"), resonatedAt: "not a date" },
            { ...resonant("ok"), resonatedAt: "2026-10-01T00:00:00.000Z" },
        ];
        expect(latestResonantItem(base)?.trackId).toBe("ok");
    });
});
