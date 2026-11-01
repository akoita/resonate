import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import {
    LOCAL_FILE_AVAILABILITY,
    REMOVED_AVAILABILITY,
    resolveTrackAvailability,
    type TrackAvailability,
} from "../catalog/track-availability";
import {
    normalizeCreditName,
    resolveCreditedArtistName,
} from "../shared/artist_attribution";

const prisma = new PrismaClient();

type CatalogLibraryIdentity = {
    releaseId: string;
    creditedArtistId: string | null;
    creditedArtistName: string | null;
};

function resolveCatalogLibraryIdentity(track: {
    artist?: string | null;
    releaseId: string;
    release: {
        primaryArtist?: string | null;
        artist: { id: string; displayName: string };
        artistCredits: Array<{ artistId: string; displayName: string; role: string; identityStatus: string }>;
    };
}): CatalogLibraryIdentity {
    const creditedArtistName = resolveCreditedArtistName({
        trackArtist: track.artist,
        credits: track.release.artistCredits,
        primaryArtist: track.release.primaryArtist,
        accountDisplayName: track.release.artist.displayName,
    });
    const normalizedName = normalizeCreditName(creditedArtistName).toLowerCase();
    const matchingCredits = track.release.artistCredits.filter(
        (credit) => normalizeCreditName(credit.displayName).toLowerCase() === normalizedName,
    );
    const matchingIds = new Set(
        matchingCredits
            .filter((credit) => credit.identityStatus !== "ambiguous")
            .map((credit) => credit.artistId),
    );

    return {
        releaseId: track.releaseId,
        creditedArtistId: matchingCredits.some((credit) => credit.identityStatus === "ambiguous")
            ? null
            : matchingIds.size === 1 ? Array.from(matchingIds)[0] : null,
        creditedArtistName,
    };
}

function extractPath(value?: string | null): string {
    if (!value) return "";
    try {
        return new URL(value, "http://resonate.local").pathname;
    } catch {
        return value;
    }
}

function decodePathSegment(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function collectCatalogReferences(track: {
    id: string;
    source: string;
    catalogTrackId?: string | null;
    remoteUrl?: string | null;
    remoteArtworkUrl?: string | null;
    previewUrl?: string | null;
}) {
    const trackIds = new Set<string>();
    const releaseIds = new Set<string>();
    const stemIds = new Set<string>();

    if (track.catalogTrackId) trackIds.add(track.catalogTrackId);

    for (const value of [track.remoteUrl, track.remoteArtworkUrl, track.previewUrl]) {
        const path = extractPath(value);
        const streamMatch = path.match(/\/catalog\/(?:me\/)?releases\/([^/]+)\/tracks\/([^/]+)\/stream/);
        if (streamMatch) {
            releaseIds.add(decodePathSegment(streamMatch[1]));
            trackIds.add(decodePathSegment(streamMatch[2]));
        }

        const artworkMatch = path.match(/\/catalog\/(?:me\/)?releases\/([^/]+)\/artwork/);
        if (artworkMatch) {
            releaseIds.add(decodePathSegment(artworkMatch[1]));
        }

        const stemMatch = path.match(/\/catalog\/stems\/([^/]+)\/preview/);
        if (stemMatch) {
            stemIds.add(decodePathSegment(stemMatch[1]));
        }
    }

    return { trackIds, releaseIds, stemIds };
}

const EMPTY_CATALOG_REFERENCES: ReturnType<typeof collectCatalogReferences> = {
    trackIds: new Set<string>(),
    releaseIds: new Set<string>(),
    stemIds: new Set<string>(),
};

/** Fields a re-save of a catalog track must never blank out once known. */
const PRESERVED_CATALOG_FIELDS = ["remoteUrl", "previewUrl", "remoteArtworkUrl", "duration"] as const;

/**
 * The update half of a re-save of a remote catalog track.
 *
 * Several surfaces save a catalog track in a partial shape (no stream URL, no
 * duration). Writing those nulls over the existing row left the owner's own
 * library copy without any audio URL, so the track stopped playing from their
 * playlists while the public copy of the same playlist still played.
 */
export function catalogResaveUpdate<T extends Record<string, unknown>>(trackData: T): T {
    const update: Record<string, unknown> = { ...trackData };
    for (const field of PRESERVED_CATALOG_FIELDS) {
        if (update[field] === null || update[field] === undefined) delete update[field];
    }
    return update as T;
}

/**
 * A playable stream path for a catalog library row that has lost its own URL.
 * Stem rows play their preview URL and local rows play a device blob, so only
 * whole-track remote rows are derived. Returns null when nothing is needed or
 * the release is unknown.
 */
export function derivedCatalogStreamPath(
    track: {
        source: string;
        stemType?: string | null;
        remoteUrl?: string | null;
        previewUrl?: string | null;
    },
    catalogTrackId: string | undefined,
    releaseId: string | undefined,
): string | null {
    if (track.source !== "remote" || track.stemType) return null;
    if (track.remoteUrl || track.previewUrl) return null;
    if (!catalogTrackId || !releaseId) return null;
    return `/catalog/releases/${encodeURIComponent(releaseId)}/tracks/${encodeURIComponent(catalogTrackId)}/stream`;
}

export interface SaveTrackInput {
    id?: string;
    source?: string;
    title: string;
    artist?: string | null;
    albumArtist?: string | null;
    album?: string | null;
    year?: number | null;
    genre?: string | null;
    duration?: number | null;
    sourcePath?: string | null;
    fileSize?: number | null;
    catalogTrackId?: string | null;
    remoteUrl?: string | null;
    remoteArtworkUrl?: string | null;
    stemType?: string | null;
    tokenId?: string | null;
    listingId?: string | null;
    purchaseDate?: string | null;
    isOwned?: boolean;
    previewUrl?: string | null;
}

export const LIBRARY_SOURCES = ["local", "remote"] as const;
export type LibrarySource = (typeof LIBRARY_SOURCES)[number];

/** Client ids for device files: `local_<time>_<random>` (see web localLibrary). */
const LOCAL_CLIENT_KEY = /^local_[A-Za-z0-9_-]{1,120}$/;
const MAX_CLIENT_KEY_LENGTH = 200;

/**
 * Fields that describe a platform track, a stem or a purchase. A device-local
 * file never carries any of them: if it did, availability, takedowns, public
 * playlists and analytics would treat a private file as a release (#2505).
 */
const CATALOG_ONLY_FIELDS = [
    "catalogTrackId",
    "remoteUrl",
    "remoteArtworkUrl",
    "previewUrl",
    "stemType",
    "tokenId",
    "listingId",
    "purchaseDate",
] as const;

function present(value: unknown): boolean {
    return value !== undefined && value !== null && value !== "";
}

function hasCatalogReference(data: SaveTrackInput): boolean {
    if (present(data.catalogTrackId)) return true;
    const refs = collectCatalogReferences({ id: "", source: "remote", ...data });
    return refs.trackIds.size > 0 || refs.releaseIds.size > 0 || refs.stemIds.size > 0;
}

/**
 * Check a library write against the local/catalog boundary and return the
 * source and client key to store. Throws 400 on a row that mixes the two.
 */
export function validateLibraryTrackInput(data: SaveTrackInput): { source: LibrarySource; clientKey: string | null } {
    const source = data.source;
    if (source !== "local" && source !== "remote") {
        throw new BadRequestException('source must be "local" or "remote"');
    }
    const clientKey = present(data.id) ? String(data.id) : null;
    if (clientKey && clientKey.length > MAX_CLIENT_KEY_LENGTH) {
        throw new BadRequestException("id is too long");
    }

    if (source === "local") {
        const mixed = CATALOG_ONLY_FIELDS.filter((field) => present(data[field]));
        if (data.isOwned) mixed.push("isOwned" as never);
        if (mixed.length > 0) {
            throw new BadRequestException(
                `A local file cannot carry catalog fields: ${mixed.join(", ")}`,
            );
        }
        if (clientKey && !LOCAL_CLIENT_KEY.test(clientKey)) {
            throw new BadRequestException("A local file id must start with local_");
        }
        return { source, clientKey };
    }

    if (present(data.sourcePath) || present(data.fileSize)) {
        throw new BadRequestException("A catalog track cannot carry local file fields");
    }
    if (clientKey && LOCAL_CLIENT_KEY.test(clientKey)) {
        throw new BadRequestException("A catalog track cannot use a local file id");
    }
    if (!hasCatalogReference(data)) {
        throw new BadRequestException("A catalog track needs a catalog reference");
    }
    return { source, clientKey };
}

/**
 * The id a client sees: the key it saved the row under when there is one, so
 * device files and owned stems keep the ids their playlists already store.
 */
export function presentLibraryTrack<T extends { id: string; clientKey?: string | null }>(track: T): T {
    return track.clientKey ? { ...track, id: track.clientKey } : track;
}

@Injectable()
export class LibraryService {
    async saveTrack(userId: string, data: SaveTrackInput) {
        return presentLibraryTrack(await this.writeTrack(userId, data));
    }

    private async writeTrack(userId: string, data: SaveTrackInput) {
        const { source, clientKey } = validateLibraryTrackInput(data);
        const trackData = {
            userId,
            source,
            title: data.title,
            artist: data.artist,
            albumArtist: data.albumArtist,
            album: data.album,
            year: data.year,
            genre: data.genre,
            duration: data.duration,
            sourcePath: source === "local" ? data.sourcePath : null,
            fileSize: source === "local" ? data.fileSize : null,
            catalogTrackId: source === "remote" ? data.catalogTrackId : null,
            remoteUrl: source === "remote" ? data.remoteUrl : null,
            remoteArtworkUrl: source === "remote" ? data.remoteArtworkUrl : null,
            stemType: source === "remote" ? data.stemType : null,
            tokenId: source === "remote" ? data.tokenId : null,
            listingId: source === "remote" ? data.listingId : null,
            purchaseDate: source === "remote" && data.purchaseDate ? new Date(data.purchaseDate) : null,
            isOwned: source === "remote" ? data.isOwned ?? false : false,
            previewUrl: source === "remote" ? data.previewUrl : null,
        };

        // Remote catalog tracks: ALWAYS dedup per-user by (userId, catalogTrackId)
        // and let the row id be a generated per-user uuid. The client-provided
        // `id` for a catalog track is the SHARED catalog track id, so it is
        // never stored as a key.
        if (source === "remote" && data.catalogTrackId) {
            return prisma.libraryTrack.upsert({
                where: {
                    userId_catalogTrackId: {
                        userId,
                        catalogTrackId: data.catalogTrackId,
                    },
                },
                update: catalogResaveUpdate(trackData),
                create: trackData,
            });
        }

        // Every other row the client names (device files, owned stems) is keyed
        // per user. The primary key is always server-generated, so no write can
        // reach a row another listener owns.
        if (clientKey) {
            // The same file saved under a new id (a cleared browser, a second
            // device) is the same row.
            if (source === "local" && data.sourcePath && data.fileSize) {
                const sameFile = await prisma.libraryTrack.findUnique({
                    where: {
                        userId_sourcePath_fileSize: { userId, sourcePath: data.sourcePath, fileSize: data.fileSize },
                    },
                    select: { id: true },
                });
                if (sameFile) {
                    return prisma.libraryTrack.update({ where: { id: sameFile.id }, data: trackData });
                }
            }
            return prisma.libraryTrack.upsert({
                where: { userId_clientKey: { userId, clientKey } },
                update: trackData,
                create: { ...trackData, clientKey },
            });
        }

        // For local tracks, dedup by sourcePath + fileSize
        if (source === "local" && data.sourcePath && data.fileSize) {
            return prisma.libraryTrack.upsert({
                where: {
                    userId_sourcePath_fileSize: {
                        userId,
                        sourcePath: data.sourcePath,
                        fileSize: data.fileSize,
                    },
                },
                update: trackData,
                create: trackData,
            });
        }

        // Fallback: just create
        return prisma.libraryTrack.create({ data: trackData });
    }

    async saveTracks(userId: string, tracks: SaveTrackInput[]) {
        const results = [];
        for (const track of tracks) {
            results.push(await this.saveTrack(userId, track));
        }
        return results;
    }

    async listTracks(userId: string, source?: string) {
        const where: any = { userId };
        if (source) where.source = source;
        const tracks = await prisma.libraryTrack.findMany({
            where,
            orderBy: { createdAt: "desc" },
        });

        const remoteTracks = tracks.filter((track) => track.source === "remote");
        const catalogTrackIds = new Set<string>();
        const catalogReleaseIds = new Set<string>();
        const catalogStemIds = new Set<string>();

        for (const track of remoteTracks) {
            const references = collectCatalogReferences(track);
            references.trackIds.forEach((id) => catalogTrackIds.add(id));
            references.releaseIds.forEach((id) => catalogReleaseIds.add(id));
            references.stemIds.forEach((id) => catalogStemIds.add(id));
        }

        if (catalogTrackIds.size === 0 && catalogReleaseIds.size === 0 && catalogStemIds.size === 0) {
            return withAvailability(tracks, new Map()).map(presentLibraryTrack);
        }

        const [existingCatalogTracks, existingCatalogReleases, existingCatalogStems] = await Promise.all([
            catalogTrackIds.size > 0
                ? prisma.track.findMany({
                    where: { id: { in: Array.from(catalogTrackIds) } },
                    select: {
                        id: true,
                        artist: true,
                        releaseId: true,
                        release: {
                            select: {
                                primaryArtist: true,
                                artist: { select: { id: true, displayName: true } },
                                artistCredits: {
                                    select: { artistId: true, displayName: true, role: true, identityStatus: true },
                                    orderBy: { sortOrder: "asc" },
                                },
                            },
                        },
                    },
                })
                : Promise.resolve([]),
            catalogReleaseIds.size > 0
                ? prisma.release.findMany({
                    where: { id: { in: Array.from(catalogReleaseIds) } },
                    select: { id: true },
                })
                : Promise.resolve([]),
            catalogStemIds.size > 0
                ? prisma.stem.findMany({
                    where: { id: { in: Array.from(catalogStemIds) } },
                    select: { id: true },
                })
                : Promise.resolve([]),
        ]);
        const existingCatalogTrackIds = new Set(existingCatalogTracks.map((track) => track.id));
        const catalogIdentities = new Map(
            existingCatalogTracks.map((track) => [track.id, resolveCatalogLibraryIdentity(track)]),
        );
        const existingCatalogReleaseIds = new Set(existingCatalogReleases.map((release) => release.id));
        const existingCatalogStemIds = new Set(existingCatalogStems.map((stem) => stem.id));
        const staleTracks = remoteTracks.filter((track) => {
            const references = collectCatalogReferences(track);
            return (
                Array.from(references.trackIds).some((id) => !existingCatalogTrackIds.has(id)) ||
                Array.from(references.releaseIds).some((id) => !existingCatalogReleaseIds.has(id)) ||
                Array.from(references.stemIds).some((id) => !existingCatalogStemIds.has(id))
            );
        });
        const staleTrackIds = staleTracks.map((track) => track.id);

        // #1793: a withdrawn release is NOT stale — its rows above still resolve,
        // so nothing is deleted. Annotate every catalog-backed row with why it
        // can or cannot be played, in one batched query.
        const availability = await resolveTrackAvailability(catalogTrackIds);

        if (staleTrackIds.length === 0) {
            return withAvailability(tracks, availability, catalogIdentities).map(presentLibraryTrack);
        }

        await prisma.libraryTrack.deleteMany({
            where: { userId, id: { in: staleTrackIds } },
        });
        // Playlists may reference these tracks by per-user LibraryTrack.id OR by
        // the shared catalogTrackId (the frontend stores catalog ids for catalog
        // tracks), so purge both sets of keys.
        const stalePlaylistKeys = new Set<string>(staleTrackIds);
        for (const track of staleTracks) {
            if (track.catalogTrackId) stalePlaylistKeys.add(track.catalogTrackId);
        }
        const stalePlaylistKeyList = Array.from(stalePlaylistKeys);
        const playlists = await prisma.playlist.findMany({
            where: { userId, trackIds: { hasSome: stalePlaylistKeyList } },
            select: { id: true, trackIds: true },
        });
        for (const playlist of playlists) {
            await prisma.playlist.update({
                where: { id: playlist.id },
                data: {
                    trackIds: playlist.trackIds.filter((id) => !stalePlaylistKeys.has(id)),
                },
            });
        }

        return withAvailability(
            tracks.filter((track) => !staleTrackIds.includes(track.id)),
            availability,
            catalogIdentities,
        ).map(presentLibraryTrack);
    }

    async getTrack(userId: string, id: string) {
        const track = await findOwnedLibraryTrack(userId, id);
        if (!track) {
            throw new NotFoundException("Library track not found");
        }
        // A device file is never a catalog track, whatever fields it carries.
        const references = track.source === "local"
            ? EMPTY_CATALOG_REFERENCES
            : collectCatalogReferences(track);
        const [catalogTrackId] = Array.from(references.trackIds);
        const catalogTrack = catalogTrackId
            ? await prisma.track.findUnique({ where: { id: catalogTrackId }, select: { releaseId: true } })
            : null;
        const [annotated] = withAvailability(
            [track],
            await resolveTrackAvailability(references.trackIds),
            new Map(),
            catalogTrack && catalogTrackId ? new Map([[catalogTrackId, catalogTrack.releaseId]]) : new Map(),
        );
        return presentLibraryTrack(annotated!);
    }

    async deleteTrack(userId: string, id: string) {
        const track = await findOwnedLibraryTrack(userId, id);
        if (!track) {
            throw new NotFoundException("Library track not found");
        }
        return presentLibraryTrack(await prisma.libraryTrack.delete({ where: { id: track.id } }));
    }

    async deleteTracks(userId: string, ids: string[]) {
        return prisma.libraryTrack.deleteMany({
            where: { userId, OR: [{ id: { in: ids } }, { clientKey: { in: ids } }] },
        });
    }

    async clearLocalTracks(userId: string) {
        return prisma.libraryTrack.deleteMany({
            where: { userId, source: "local" },
        });
    }
}

/**
 * Annotate library rows with catalog availability (#1793).
 *
 * A row whose release an artist withdrew STAYS in the library — it is returned
 * with `availability.state === "withdrawn"` so the person sees what happened
 * instead of finding a hole. Device-local rows report "local_file".
 */
function withAvailability<
    T extends {
        id: string;
        source: string;
        catalogTrackId?: string | null;
        remoteUrl?: string | null;
        remoteArtworkUrl?: string | null;
        previewUrl?: string | null;
        stemType?: string | null;
    },
>(
    tracks: T[],
    availability: Map<string, TrackAvailability>,
    catalogIdentities: Map<string, CatalogLibraryIdentity> = new Map(),
    catalogReleaseIds: Map<string, string> = new Map(),
): Array<T & {
    availability: TrackAvailability;
    releaseId?: string;
    creditedArtistId?: string | null;
    creditedArtistName?: string | null;
}> {
    return tracks.map((track) => {
        // A device file is never a catalog track, whatever fields it carries.
        const references = track.source === "local"
            ? EMPTY_CATALOG_REFERENCES
            : collectCatalogReferences(track);
        const [catalogTrackId] = Array.from(references.trackIds);
        if (!catalogTrackId) {
            return { ...track, availability: LOCAL_FILE_AVAILABILITY };
        }
        const identity = catalogIdentities.get(catalogTrackId);
        const releaseId =
            identity?.releaseId ?? catalogReleaseIds.get(catalogTrackId) ?? Array.from(references.releaseIds)[0];
        // Self-heal rows an earlier partial save left without an audio URL.
        const derivedRemoteUrl = derivedCatalogStreamPath(track, catalogTrackId, releaseId);
        return {
            ...track,
            ...(derivedRemoteUrl ? { remoteUrl: derivedRemoteUrl } : {}),
            ...(releaseId ? { releaseId } : {}),
            availability: availability.get(catalogTrackId) ?? REMOVED_AVAILABILITY,
            ...(identity || {}),
        };
    });
}

/**
 * Resolve a LibraryTrack owned by `userId` from its per-user `id`, the
 * `clientKey` the client saved it under, or its shared `catalogTrackId`.
 * Frontend callers may still pass a catalog id for tracks added before the
 * per-user-row fix, so accept all three — always scoped to the owner.
 */
async function findOwnedLibraryTrack(userId: string, id: string) {
    const track = await prisma.libraryTrack.findFirst({
        where: { userId, OR: [{ id }, { clientKey: id }, { catalogTrackId: id }] },
    });
    return track;
}
