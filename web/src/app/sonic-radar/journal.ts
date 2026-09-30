import type { DiscoveryJournal, DiscoveryJournalGroup, DiscoveryJournalItem } from "../../lib/api";
import type { LocalTrack } from "../../lib/localLibrary";

const DAY_MS = 86_400_000;

/**
 * Group heading for a journal group. The API groups by the UTC calendar day of
 * the qualifying listen, so the label is computed in UTC as well.
 */
export function formatGroupLabel(group: Pick<DiscoveryJournalGroup, "date" | "sessionId">, now: Date = new Date()): string {
    const day = Date.parse(`${group.date}T00:00:00.000Z`);
    if (!Number.isFinite(day)) return group.sessionId ? "AI DJ session" : "Earlier";
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const diff = Math.round((today - day) / DAY_MS);

    let when: string;
    if (diff <= 0) when = "Today";
    else if (diff === 1) when = "Yesterday";
    else if (diff < 7) when = `${diff} days ago`;
    else {
        when = new Date(day).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
        });
    }
    return group.sessionId ? `${when} · AI DJ session` : when;
}

export function followUpLabel(followUp: DiscoveryJournalItem["followUp"]): string {
    return followUp === "saved" ? "Saved" : "Replayed";
}

export function trackCountLabel(count: number): string {
    return `${count} track${count === 1 ? "" : "s"}`;
}

export function hasJournalItems(journal: DiscoveryJournal | null): boolean {
    return Boolean(journal?.groups.some((group) => group.items.length > 0));
}

/** A catalog track in the shape the playlist picker expects. */
export function journalItemToLocalTrack(item: DiscoveryJournalItem): LocalTrack {
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
