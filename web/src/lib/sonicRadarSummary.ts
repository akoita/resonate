import { getReleaseTrackStreamUrl } from "./api";
import type { DiscoveryJournal, DiscoveryJournalNewReleaseItem, DiscoveryJournalPendingItem } from "./api";
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

/** A catalog track that can be played straight from the catalog without saving it. */
export function catalogItemToPlayableTrack(item: CatalogTrackFields): LocalTrack {
    return {
        ...catalogItemToLocalTrack(item),
        remoteUrl: getReleaseTrackStreamUrl(item.releaseId, item.trackId),
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

/** Recent tracks by artists the listener discovered. Empty for older backends. */
export function newFromDiscoveredItems(journal: DiscoveryJournal | null | undefined): DiscoveryJournalNewReleaseItem[] {
    return journal?.newFromDiscovered ?? [];
}

export type SonicRadarSessionLine =
    | { kind: "session"; saved: number; replayed: number }
    | { kind: "pending"; count: number }
    | { kind: "none" };

/**
 * What the AI DJ panel says about Sonic Radar for the live session (#2313): only journal items
 * whose track is in the live DJ set count. A resonant item has exactly one follow-up ("saved" or
 * "replayed"), so no track is counted twice; a track both replayed and saved is reported by the
 * journal as saved. Resonant tracks win over the "one save away" nudge. Nothing for no live set,
 * or nothing from it in the journal (including items outside the journal's own window).
 */
export function sonicRadarSessionLine(
    journal: DiscoveryJournal | null | undefined,
    sessionTrackIds: readonly string[] | null | undefined,
): SonicRadarSessionLine {
    if (!journal || !sessionTrackIds || sessionTrackIds.length === 0) return { kind: "none" };
    const live = new Set(sessionTrackIds);
    const counted = new Set<string>();
    let saved = 0;
    let replayed = 0;
    for (const group of journal.groups) {
        for (const item of group.items) {
            if (!live.has(item.trackId) || counted.has(item.trackId)) continue;
            counted.add(item.trackId);
            if (item.followUp === "saved") saved += 1;
            else replayed += 1;
        }
    }
    if (saved + replayed > 0) return { kind: "session", saved, replayed };
    const pendingCount = new Set(
        pendingItems(journal)
            .map((item) => item.trackId)
            .filter((id) => live.has(id)),
    ).size;
    if (pendingCount > 0) return { kind: "pending", count: pendingCount };
    return { kind: "none" };
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

/** Badge copy for a new release, e.g. "Added today" or "Added 3 days ago" (UTC calendar days). */
export function addedAgoLabel(addedAt: string, now: Date = new Date()): string {
    const added = Date.parse(addedAt);
    if (!Number.isFinite(added)) return "Recently added";
    const startOfUtcDay = (ms: number) => Math.floor(ms / DAY_MS);
    const days = Math.max(0, startOfUtcDay(now.getTime()) - startOfUtcDay(added));
    if (days === 0) return "Added today";
    if (days === 1) return "Added yesterday";
    return `Added ${days} days ago`;
}
