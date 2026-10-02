import { getTrack } from "./api";
import { catalogTrackToLocal, type LocalTrack } from "./localLibrary";

/**
 * Resolve the AI DJ's picked track ids into a playable queue.
 *
 * Ids are de-duplicated (first occurrence wins, order preserved), looked up in
 * the catalog in parallel, and mapped to remote `LocalTrack`s. A track that
 * fails to load, or that has no stream URL, is skipped so one bad pick never
 * blocks the rest of the set.
 */
export async function resolveDjQueue(
    trackIds: string[],
    token?: string | null,
): Promise<LocalTrack[]> {
    const uniqueIds = Array.from(new Set(trackIds.filter(Boolean)));
    const resolved = await Promise.all(
        uniqueIds.map(async (trackId) => {
            try {
                const catalogTrack = await getTrack(trackId, token);
                return catalogTrack ? catalogTrackToLocal(catalogTrack) : null;
            } catch {
                return null;
            }
        }),
    );
    return resolved.filter((track): track is LocalTrack => Boolean(track?.remoteUrl));
}
