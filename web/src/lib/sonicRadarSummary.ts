import type { DiscoveryJournal, DiscoveryJournalPendingItem } from "./api";
import type { LocalTrack } from "./localLibrary";

const DAY_MS = 86_400_000;

type CatalogTrackFields = Pick<
    DiscoveryJournalPendingItem,
    "trackId" | "title" | "artistId" | "artistName" | "releaseId" | "releaseTitle" | "artworkUrl"
>;

/** A catalog track in the shape the library and playlist picker expect. */
export function catalogItemToLocalTrack(item: CatalogTrackFields): LocalTrack {
    return {
        id: item.trackId,
        title: item.title,
        artist: item.artistName,
        albumArtist: null,
        album: item.releaseTitle,
        year: null,
        genre: null,
        duration: null,
        createdAt: new Date().toISOString(),
        source: "remote",
        catalogTrackId: item.trackId,
        artistId: item.artistId,
        releaseId: item.releaseId,
        remoteArtworkUrl: item.artworkUrl || undefined,
    };
}

export function pendingItemToLocalTrack(item: DiscoveryJournalPendingItem): LocalTrack {
    return catalogItemToLocalTrack(item);
}

/** Number of resonant tracks across all journal groups. */
export function resonantItemCount(journal: DiscoveryJournal | null | undefined): number {
    return journal?.groups.reduce((sum, group) => sum + group.items.length, 0) ?? 0;
}

/** Tracks played through but not yet replayed or saved. Empty for older backends. */
export function pendingItems(journal: DiscoveryJournal | null | undefined): DiscoveryJournalPendingItem[] {
    return journal?.pending ?? [];
}

export type SonicRadarBanner =
    | { kind: "resonant"; count: number; newArtistsThisWeek: number; windowDays: number }
    | { kind: "pending"; count: number }
    | { kind: "empty" };

/** What the AI DJ page says about Sonic Radar, derived from the journal itself. */
export function sonicRadarBanner(journal: DiscoveryJournal | null | undefined): SonicRadarBanner {
    const count = resonantItemCount(journal);
    if (journal && count > 0) {
        return {
            kind: "resonant",
            count,
            newArtistsThisWeek: journal.headline.newArtistsThisWeek,
            windowDays: journal.window.days,
        };
    }
    const pendingCount = pendingItems(journal).length;
    if (pendingCount > 0) return { kind: "pending", count: pendingCount };
    return { kind: "empty" };
}

/** Whole days left to save or replay a track (rounded up, never below 0). */
export function followUpDaysLeft(followUpBy: string, now: Date = new Date()): number {
    const deadline = Date.parse(followUpBy);
    if (!Number.isFinite(deadline)) return 0;
    return Math.max(0, Math.ceil((deadline - now.getTime()) / DAY_MS));
}

/** Badge copy for a pending track, e.g. "Save within 3 days" or "Last day to save". */
export function saveDeadlineLabel(followUpBy: string, now: Date = new Date()): string {
    const days = followUpDaysLeft(followUpBy, now);
    if (days <= 1) return "Last day to save";
    return `Save within ${days} days`;
}
